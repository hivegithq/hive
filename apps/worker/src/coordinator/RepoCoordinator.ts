import { agentOf, landing, mergeBoxOf, plannerOf, simOf } from "../bindings.ts";
import { Agent, type Connection } from "agents";
import { adviseOnOverlap, judgeRace, type OverlapAction } from "../decide/policy.ts";
import type {
	Change,
	ChangeStatus,
	Decision,
	Evaluation,
	Evidence,
	Goal,
	HiveEvent,
	Intent,
	Overlap,
	SymbolRef,
} from "../domain/types.ts";
import { authenticatedRemote, changeRepo, head, ledgerRepo, parseTrailers, repoHost } from "../repo/index.ts";
import { detectOverlaps, type ReferenceGraph } from "./overlap.ts";
import { modelForSubgoal, nextSubgoal, type PlannedGoal, type PlanSettings, readPlanSettings, validatePlan } from "./plans.ts";
import { repoPath } from "../agent/paths.ts";
import { PROBE_FILES, planEvidence } from "../evidence/plan.ts";
import { selectBatch } from "../landing/batch.ts";
import { INTENT_SCHEMA, IntentStore, toIntent, touched } from "./intents.ts";
import { ForkPool } from "./forks.ts";
import { SCHEMA } from "./schema.ts";
import { type LedgerFiles, writeLedger } from "../ledger/ledger.ts";
import { containerCost, modelCost, usd } from "../domain/pricing.ts";
import { budgetExceeded, type GoalNode, treeSpend } from "./costs.ts";
import { CLEF_MODEL, metered } from "../decide/clef.ts";
import { leaderboard } from "./leaderboard.ts";
import { gh, goalFromIssue, listOpenIssues, parseGitHubRepo, selectIssues, upsertPullRequest } from "../github/github.ts";
import { type PrGoal, prBody, prTitle } from "../github/pr.ts";
import { open as openSecret, seal as sealSecret } from "../github/secret.ts";
import { checkUrl, EVENTS, emailFor, maskUrl, type Format, formatFor, type Hook, type Notice, type NotifyEvent, payload, sign } from "../notify/notify.ts";
import { feedback, type ReviewComment } from "../review/comments.ts";
import { describeEvery, dueNow, nextAfter, parseEvery } from "./recurring.ts";
import { contextBreakdown } from "../agent/context.ts";
import { type Msg, rewind, steps } from "../agent/rewind.ts";
import { provenance } from "./provenance.ts";

export interface IntentResult {
	intent: Intent;
	overlaps: Overlap[];
	advice: { severity: number; action: OverlapAction; probabilities: Record<string, number> } | null;
}

export interface LandingParams {
	repo: string;
	changeIds: string[]; // a batch for "land"; exactly one race candidate for "evaluate"
	slot?: number; // which of the repo's pipelined merge boxes a landing batch uses
	mode: "land" | "evaluate"; // evaluate = race candidate: gather evidence + review, don't touch trunk
}

export interface RepoSettings {
	decider: "clef" | "evidence"; // evidence: deterministic checks decide, no model calls
	batchMax: number; // changes stacked and verified together per landing
	security: boolean; // also run the security scan; findings a change introduces fail it (hive.json can turn it on too)
	goalBudget: number | null; // USD a goal (with its sub-goals) may spend unless it sets its own; null = no limit
	reviewModel: string | null; // who writes the review that Clef's decision rests on; null = the deployment's REVIEW_MODEL
	autoFix: boolean; // when Clef isn't sure and the review raised concerns, start one fixing pass on its own
}

const DEFAULT_SETTINGS: RepoSettings = { decider: "clef", batchMax: 16, security: false, goalBudget: null, reviewModel: null, autoFix: false };

const LANDING_TIMEOUT_MS = 20 * 60 * 1000;
const cleanPath = (p: string) => {
	try {
		return repoPath(p);
	} catch {
		return p;
	}
};

export interface TrunkChecks {
	commit: string;
	at: number;
	ok: boolean;
	languages: string[];
	source: string;
	runs: { kind: string; command: string; ok: boolean }[];
}

// Planning reads a lot of code: GLM 5.3 has a 1M-token context.
const PLANNER_MODEL = "@cf/zai-org/glm-5.3";
// Diffs kept for the dashboard; bigger ones are cut (the change itself is in its fork).
const MAX_DIFF_CHARS = 400_000;

const MAX_LANDING_RESTARTS = 3;
const PIPELINE_DEPTH = 2;
type AgentKind = "builtin" | "mcp" | "cli" | "sim";

// Brings GitHub's new commits in as an ordinary change (decided on evidence alone).
export const UPSTREAM_AGENT = "hive:upstream";

interface GitHubConfig {
	owner: string;
	repo: string;
	base: string; // GitHub's default branch: pull requests target it, syncs read it
	branch: string; // where trunk is mirrored
	mirror: boolean;
	prs: boolean;
	pull: boolean;
	token: string; // sealed
	connectedAt: number;
	lastSynced: string | null; // last upstream commit brought in
	pendingSync: { changeId: string; upstreamHead: string } | null;
	lastRun: number | null;
	lastMirror: { at: number; head: string } | null;
	lastPull: { at: number; count: number } | null;
	error: string | null;
}
const id = (prefix: string) => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
const now = () => Date.now();

// One coordinator per trunk repo. Owns intents, the convergence queue, the ledger,
// and is the only thing that lets a change reach trunk (one converging change at a time).
export class RepoCoordinator extends Agent<Env> {
	private get repo() {
		return this.name;
	}
	// Schema, migrations and stores are set up synchronously on first use. RPCs can reach a freshly
	// woken object before onStart runs, so nothing may depend on onStart having happened.
	private migrated = false;
	private store: IntentStore | null = null;

	private get db() {
		const sql = this.ctx.storage.sql;
		if (!this.migrated) {
			this.migrated = true;
			for (const stmt of SCHEMA) sql.exec(stmt);
			for (const column of ["landing_instance TEXT", "landing_mode TEXT", "landing_started INTEGER", "landing_restarts INTEGER"]) {
				try {
					sql.exec(`ALTER TABLE changes ADD COLUMN ${column}`);
				} catch {
					// already present
				}
			}
			for (const stmt of INTENT_SCHEMA) sql.exec(stmt);
			// Backfill the target index for intents declared before it existed.
			if (Number(sql.exec("SELECT COUNT(*) AS n FROM intent_targets").one().n) === 0) {
				for (const i of sql.exec("SELECT * FROM intents WHERE released_at IS NULL").toArray().map(toIntent)) {
					for (const path of touched(i)) sql.exec("INSERT OR IGNORE INTO intent_targets VALUES (?, ?)", i.id, path);
				}
			}
		}
		return sql;
	}

	private get intents(): IntentStore {
		this.store ??= new IntentStore(this.db);
		return this.store;
	}

	async onStart() {
		void this.db;
		await this.scheduleEvery(90, "wakeAgents");
	}

	private async startLanding(changeIds: string[], mode: LandingParams["mode"], slot = 0) {
		// Workflow instance ids are global, so they carry the repo name.
		const id = `${this.repo}-${mode === "land" ? "batch" : changeIds[0]}-${now()}`;
		if (mode === "land") this.db.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", `slot:${id}`, String(slot));
		await landing(this.env).create({ id, params: { repo: this.repo, changeIds, mode, slot } satisfies LandingParams });
		const t = now();
		for (const changeId of changeIds) {
			this.db.exec("UPDATE changes SET landing_instance = ?, landing_mode = ?, landing_started = ? WHERE id = ?", id, mode, t, changeId);
		}
	}

	// Landings are Workflows and normally survive restarts. If one errored, was terminated, or
	// has been running far longer than any landing should, start it again with the same changes.
	private async reviveStalledLandings() {
		const rows = this.db.exec("SELECT id, landing_instance, landing_mode, landing_started FROM changes WHERE status = 'converging'").toArray();
		const byInstance = new Map<string, { mode: LandingParams["mode"]; started: number; changeIds: string[] }>();
		for (const r of rows) {
			const key = r.landing_instance === null ? `none:${r.id}` : String(r.landing_instance);
			const entry = byInstance.get(key) ?? { mode: r.landing_mode === "evaluate" ? "evaluate" : "land", started: Number(r.landing_started ?? 0), changeIds: [] };
			entry.changeIds.push(String(r.id));
			byInstance.set(key, entry);
		}
		for (const [instance, { mode, started, changeIds }] of byInstance) {
			let stalled = instance.startsWith("none:") || now() - started > LANDING_TIMEOUT_MS;
			if (!stalled) {
				try {
					const { status } = await landing(this.env).get(instance).then((i) => i.status());
					// "complete" with changes still converging means the batch stranded them.
					stalled = ["errored", "terminated", "unknown", "complete"].includes(status);
				} catch {
					stalled = true;
				}
			}
			if (!stalled) continue;
			if (!instance.startsWith("none:")) await landing(this.env).get(instance).then((i) => i.terminate()).catch(() => {});
			// A landing that keeps failing (missing trunk, broken fork) goes to a person, not round again.
			const retry: string[] = [];
			for (const changeId of changeIds) {
				this.db.exec("UPDATE changes SET landing_restarts = COALESCE(landing_restarts, 0) + 1 WHERE id = ?", changeId);
				const restarts = Number(this.db.exec("SELECT landing_restarts AS n FROM changes WHERE id = ?", changeId).one().n);
				if (restarts > MAX_LANDING_RESTARTS) {
					await this.escalated(changeId, { confidence: 1, probabilities: { escalate: 1 }, rationale: `Landing failed ${restarts - 1} times; a person should look.`, decidedBy: "hive:watchdog" }, { pump: false });
				} else retry.push(changeId);
			}
			const slotRow = this.db.exec("SELECT value FROM meta WHERE key = ?", `slot:${instance}`).toArray()[0];
			this.releaseLease(instance);
			if (retry.length === 0) continue;
			this.log("hive", `restarting stalled landing for ${retry.length} change(s)`);
			await this.startLanding(retry, mode, slotRow ? Number(slotRow.value) : 0);
		}
	}

	// ── Metrics ──────────────────────────────────────────────────────────────

	recordMetric(name: string, value: number) {
		this.db.exec("INSERT INTO metrics VALUES (?, ?, ?)", name, value, now());
	}

	// Throughput and latency for this repo, for load tests and the README.
	stats(sinceMs = 0) {
		const statusCounts = Object.fromEntries(
			this.db.exec("SELECT status, COUNT(*) AS n FROM changes WHERE created_at >= ? GROUP BY status", sinceMs).toArray().map((r) => [String(r.status), Number(r.n)]),
		);
		// Time from a change's creation (fork) and from its submission to its landing decision. The
		// latest 'land' decision is the landing itself (a person's approval is an earlier one).
		const landed = this.db
			.exec(
				`SELECT c.created_at AS created, c.submitted_at AS submitted, MAX(d.created_at) AS landed_at FROM changes c
				 JOIN decisions d ON d.change_id = c.id AND d.outcome = 'land'
				 WHERE c.status = 'landed' AND c.created_at >= ? GROUP BY c.id`,
				sinceMs,
			)
			.toArray()
			.map((r) => ({ created: Number(r.created), submitted: Number(r.submitted), landedAt: Number(r.landed_at) }));
		const pct = (xs: number[], p: number) => (xs.length ? xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : null);
		const queueWait = landed.map((l) => l.landedAt - l.submitted);
		const endToEnd = landed.map((l) => l.landedAt - l.created);
		const first = landed.length ? Math.min(...landed.map((l) => l.landedAt)) : 0;
		const last = landed.length ? Math.max(...landed.map((l) => l.landedAt)) : 0;
		const metric = (name: string) =>
			this.db.exec("SELECT COUNT(*) AS n, AVG(value) AS avg, MAX(value) AS max FROM metrics WHERE name = ? AND at >= ?", name, sinceMs).one();
		const batches = metric("batch_size");
		const forkMs = this.db.exec("SELECT value FROM metrics WHERE name = 'fork_ms' AND at >= ?", sinceMs).toArray().map((r) => Number(r.value));
		const intentMs = this.db.exec("SELECT value FROM metrics WHERE name = 'intent_ms' AND at >= ?", sinceMs).toArray().map((r) => Number(r.value));
		return {
			changes: statusCounts,
			landed: landed.length,
			landedPerMinute: landed.length > 1 && last > first ? +(landed.length / ((last - first) / 60000)).toFixed(1) : null,
			queueWaitMs: { p50: pct(queueWait, 50), p95: pct(queueWait, 95) },
			endToEndMs: { p50: pct(endToEnd, 50), p95: pct(endToEnd, 95) },
			forkMs: { n: forkMs.length, p50: pct(forkMs, 50), p95: pct(forkMs, 95) },
			intentCheckMs: { n: intentMs.length, p50: pct(intentMs, 50), p95: pct(intentMs, 95) },
			batches: { count: Number(batches.n), avgSize: batches.avg === null ? null : +Number(batches.avg).toFixed(1), maxSize: batches.max === null ? null : Number(batches.max) },
			liveIntents: this.intents.liveCount(),
			trunkRed: this.trunkRed(),
			mirrors: this.db.exec("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'mirror:%'").one().n,
		};
	}

	// ── Settings ─────────────────────────────────────────────────────────────

	settings(): RepoSettings {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'settings'").toArray()[0];
		return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(String(row.value)) : {}) };
	}

	setSettings(patch: Partial<RepoSettings>): RepoSettings {
		const next = { ...this.settings(), ...patch };
		next.batchMax = Math.max(1, Math.min(256, Math.floor(next.batchMax)));
		next.autoFix = next.autoFix === true;
		next.reviewModel = next.reviewModel && /^@?[\w./:-]{3,100}$/.test(next.reviewModel) ? next.reviewModel : null;
		next.goalBudget = next.goalBudget === null || next.goalBudget === undefined || Number(next.goalBudget) <= 0 ? null : Number(next.goalBudget);
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('settings', ?)", JSON.stringify(next));
		return next;
	}

	// Waking an agent's Durable Object lets it recover an interrupted fiber (deploys, restarts).
	async wakeAgents() {
		await this.reviveStalledLandings();
		await this.runDueRecurring().catch((e) => console.warn("recurring check failed", e));
		const gh = this.githubConfig();
		if (gh?.pull && now() - (gh.lastRun ?? 0) > 10 * 60_000) this.ctx.waitUntil(this.githubSync().catch((e) => console.warn("github sync failed", e)));
		await this.noticeTrunkPushes().catch((e) => console.warn("trunk check failed", e));
		// Plans whose sub-goals were unblocked while nobody was looking (a deploy, an eviction).
		for (const r of this.db.exec("SELECT key FROM meta WHERE key LIKE 'plan:%'").toArray()) {
			const goalId = String(r.key).slice(5);
			if (["planned", "in_progress"].includes(this.goal(goalId)?.status ?? "")) await this.advancePlan(goalId).catch((e) => console.warn("advance plan failed", e));
		}
		const rows = this.db
			.exec("SELECT c.id, c.agent_id FROM changes c JOIN agents a ON a.id = c.agent_id WHERE c.status IN ('drafting','bounced') AND a.kind = 'builtin'")
			.toArray();
		// Waking an agent resumes it; one that has given up (stopped without submitting, or failed)
		// leaves its change waiting for a person instead of looking busy forever.
		await Promise.all(
			rows.map(async (r) => {
				const h = await agentOf(this.ctx.exports, String(r.agent_id))
					.health()
					.catch(() => null);
				if (h?.phase === "failed" && h.changeId === String(r.id) && h.lastError !== "budget reached") await this.agentGaveUp(String(r.id), h.steps, h.lastError);
			}),
		);

		// Simulated agents get their bounce again if it may have been lost (they ignore duplicates),
		// and a nudge if their change has been drafting a while.
		const sims = this.db
			.exec(
				`SELECT c.id, c.agent_id, c.status FROM changes c JOIN agents a ON a.id = c.agent_id
				 WHERE c.status IN ('drafting','bounced') AND a.kind = 'sim' AND c.updated_at < ? ORDER BY RANDOM() LIMIT 100`,
				now() - 120_000,
			)
			.toArray();
		await Promise.all(
			sims.map((r) => {
				const sim = simOf(this.ctx.exports, String(r.agent_id));
				return (r.status === "bounced" ? sim.onBounced("redelivered") : sim.ping()).catch(() => null);
			}),
		);
	}

	onConnect(connection: Connection) {
		connection.send(JSON.stringify({ type: "snapshot", snapshot: this.snapshot() }));
	}

	// Events go out in batches every 250ms (or every 500 events), and each agent's log lines are
	// throttled to one per second: with thousands of agents, one message per event would swamp
	// every connected dashboard.
	private outbox: HiveEvent[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private lastLog = new Map<string, number>();

	private emit(event: HiveEvent) {
		if (event.type === "log") {
			const t = Date.now();
			if ((this.lastLog.get(event.agentId) ?? 0) > t - 1000) return;
			this.lastLog.set(event.agentId, t);
			if (this.lastLog.size > 5000) this.lastLog.clear();
		}
		this.outbox.push(event);
		if (this.outbox.length >= 500) this.flush();
		else this.flushTimer ??= setTimeout(() => this.flush(), 250);
	}

	private flush() {
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = null;
		if (this.outbox.length === 0) return;
		const events = this.outbox;
		this.outbox = [];
		this.broadcast(JSON.stringify({ type: "batch", events }));
	}

	// ── Repos ────────────────────────────────────────────────────────────────

	// Ensure the trunk and ledger repos exist. Returns the trunk remote.
	async init(): Promise<{ trunk: string; ledger: string }> {
		const host = repoHost(this.env);
		const trunk = (await host.get(this.repo)) ?? (await host.create(this.repo, "Hive trunk"));
		const ledger = (await host.get(ledgerRepo(this.repo))) ?? (await host.create(ledgerRepo(this.repo), "Hive ledger"));
		return { trunk: trunk.remote, ledger: ledger.remote };
	}

	// What the merge queue will check, read from trunk's manifests (no container needed).
	async checkPlan() {
		const host = repoHost(this.env);
		const files = new Set(await host.listFiles(this.repo, "main").catch(() => [] as string[]));
		const found: Record<string, string> = {};
		for (const f of PROBE_FILES.filter((p) => files.has(p))) found[f] = (await host.readFile(this.repo, "main", f)) ?? "";
		return planEvidence(found, { security: this.settings().security });
	}

	// Run the checks on trunk, in a merge box of its own. The outcome is kept so dashboards can show it.
	async checkTrunk() {
		const r = await mergeBoxOf(this.ctx.exports, `${this.repo}:checks`).checkTrunk({ repo: this.repo, security: this.settings().security });
		const kept: TrunkChecks = {
			commit: r.commit,
			at: now(),
			ok: r.runs.every((x) => x.ok),
			languages: r.plan.languages,
			source: r.plan.source,
			runs: r.runs.map((x) => ({ kind: x.kind, command: x.command, ok: x.ok })),
		};
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('trunk_checks', ?)", JSON.stringify(kept));
		this.emit({ type: "checks", checks: kept } as unknown as HiveEvent);
		return r;
	}

	trunkChecks(): TrunkChecks | null {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'trunk_checks'").toArray()[0];
		return row ? (JSON.parse(String(row.value)) as TrunkChecks) : null;
	}

	// The repository in a few numbers, for Hive-wide stats.
	summary() {
		const byModel = this.db
			.exec("SELECT model, status, COUNT(*) AS n FROM changes GROUP BY model, status")
			.toArray()
			.map((r) => ({ model: String(r.model), status: String(r.status), n: Number(r.n) }));
		const sum = (f: (r: { model: string; status: string }) => boolean) => byModel.filter(f).reduce((a, r) => a + r.n, 0);
		const ai = (r: { model: string }) => r.model !== "sim";
		return {
			repo: this.repo,
			changes: sum(() => true),
			landed: sum((r) => r.status === "landed"),
			aiChanges: sum(ai),
			aiLanded: sum((r) => ai(r) && r.status === "landed"),
			models: [...new Set(byModel.filter(ai).map((r) => r.model))],
			goals: Number(this.db.exec("SELECT COUNT(*) AS n FROM goals").one().n),
			plans: Number(this.db.exec("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'plan:%'").one().n),
			batches: Number(this.db.exec("SELECT COUNT(*) AS n FROM metrics WHERE name = 'batch_size'").one().n),
			checks: this.trunkChecks(),
			inFlight: Number(this.db.exec("SELECT COUNT(*) AS n FROM changes WHERE status IN ('drafting','submitted','converging','bounced','evaluated')").one().n),
			needsYou: Number(this.db.exec("SELECT COUNT(*) AS n FROM changes WHERE status = 'escalated'").one().n),
			spend: Number(this.db.exec("SELECT COALESCE(SUM(cost), 0) AS c FROM usage").one().c),
			lastAt: Number(this.db.exec("SELECT COALESCE(MAX(updated_at), 0) AS t FROM changes").one().t),
		};
	}

	// Import an existing repository into this (new, empty) trunk.
	async importFrom(input: { url: string; branch?: string; token?: string }) {
		await this.init();
		if ((await repoHost(this.env).log(this.repo, { limit: 1 }).catch(() => [])).length > 0) {
			throw new Error(`${this.repo} already has commits; import into a new repository`);
		}
		this.log("hive", `importing ${input.url}${input.branch ? ` (${input.branch})` : ""}`);
		const result = await mergeBoxOf(this.ctx.exports, `${this.repo}:import`).importRepo({ repo: this.repo, ...input });
		// Remember where it came from (never the token): issues and pushing back use it.
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('origin', ?)", JSON.stringify({ url: input.url, branch: input.branch ?? null }));
		this.log("hive", `imported ${result.commits} commits, ${result.files} files; trunk at ${result.head.slice(0, 8)}`);
		await this.onTrunkPush(result.head, []);
		return result;
	}

	// ── Goals ────────────────────────────────────────────────────────────────

	createGoal(input: { title: string; description: string; parentId?: string }): Goal {
		const goal: Goal = {
			id: id("g"),
			repo: this.repo,
			title: input.title,
			description: input.description,
			status: "open",
			parentId: input.parentId ?? null,
			createdAt: now(),
		};
		this.db.exec(
			"INSERT INTO goals VALUES (?, ?, ?, ?, ?, ?)",
			goal.id,
			goal.title,
			goal.description,
			goal.status,
			goal.parentId,
			goal.createdAt,
		);
		this.emit({ type: "goal", goal });
		return goal;
	}

	setGoalStatus(goalId: string, status: Goal["status"]) {
		this.db.exec("UPDATE goals SET status = ? WHERE id = ?", status, goalId);
		const goal = this.goal(goalId);
		if (goal) this.emit({ type: "goal", goal });
		if (goal && status === "achieved" && !goal.parentId) {
			const pr = this.db.exec("SELECT url FROM goal_prs WHERE goal_id = ? AND url IS NOT NULL", goalId).toArray()[0];
			this.notify({ event: "goal-landed", text: `“${goal.title}” landed${pr ? ` (${pr.url})` : ""}.`, goalId });
		}
		// A landed sub-goal may unblock its siblings, or complete its parent.
		if (goal?.parentId && status === "achieved") this.ctx.waitUntil(this.advancePlan(goal.parentId).catch((e) => console.warn("advance plan failed", e)));
	}

	// ── Plans ────────────────────────────────────────────────────────────────

	// A planner breaks a big goal into sub-goals; Hive runs them as their dependencies land.
	async plan(goalId: string, opts: { model?: string; agentModel?: string; agentModels?: string[]; maxParallel?: number } = {}) {
		const goal = this.goal(goalId);
		if (!goal) throw new Error(`unknown goal ${goalId}`);
		if (!["open", "planning"].includes(goal.status)) throw new Error(`goal ${goalId} is ${goal.status}`);
		const agentModels = [...new Set(opts.agentModels?.length ? opts.agentModels : [opts.agentModel ?? this.env.CODER_MODEL])];
		const settings: PlanSettings = {
			model: opts.model ?? PLANNER_MODEL,
			agentModels,
			maxParallel: Math.max(1, Math.min(32, opts.maxParallel ?? 6)),
		};
		this.db.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", `plan:${goalId}`, JSON.stringify(settings));
		this.setGoalStatus(goalId, "planning");
		const plannerId = id("p");
		this.log(plannerId, `planning "${goal.title}" with ${settings.model}`);
		await plannerOf(this.ctx.exports, plannerId).start({ repo: this.repo, goalId, model: settings.model });
		return { plannerId, ...settings };
	}

	// What a planner needs to look around: trunk's files and the code graph's symbols.
	planningContext(goalId: string) {
		const goal = this.goal(goalId);
		if (!goal) throw new Error(`unknown goal ${goalId}`);
		return { goal, index: this.indexStatus() };
	}

	referencesTo(path: string, name: string): { path: string; name: string }[] {
		return this.db
			.exec("SELECT from_path, from_name FROM refs WHERE to_path = ? AND to_name = ? LIMIT 50", path, name)
			.toArray()
			.map((r) => ({ path: String(r.from_path), name: String(r.from_name) }));
	}

	// The planner's proposal: sub-goals with dependencies (by key). Validated, then started.
	async applyPlan(goalId: string, plan: { summary: string; subgoals: PlannedGoal[] }): Promise<{ goals: string[] }> {
		const parent = this.goal(goalId);
		if (!parent) throw new Error(`unknown goal ${goalId}`);
		const problem = validatePlan(plan.subgoals);
		if (problem) throw new Error(problem);
		const ids = new Map<string, string>();
		this.ctx.storage.transactionSync(() => {
			for (const s of plan.subgoals) {
				const paths = s.paths?.length ? `\n\nLikely files: ${s.paths.join(", ")}` : "";
				const g = this.createGoal({ title: s.title, description: `${s.description}${paths}\n\nPart of "${parent.title}": ${plan.summary}`, parentId: goalId });
				ids.set(s.key, g.id);
			}
			for (const s of plan.subgoals) for (const d of s.dependsOn ?? []) this.db.exec("INSERT OR IGNORE INTO goal_deps VALUES (?, ?)", ids.get(s.key)!, ids.get(d)!);
		});
		this.setGoalStatus(goalId, "planned");
		this.log("hive", `"${parent.title}" planned as ${plan.subgoals.length} sub-goals`);
		await this.advancePlan(goalId);
		return { goals: [...ids.values()] };
	}

	planFailed(goalId: string, reason: string) {
		this.setGoalStatus(goalId, "open");
		this.log("hive", `planning failed: ${reason.slice(0, 300)}`);
	}

	// Start every sub-goal whose dependencies have all landed, up to the plan's parallelism; mark
	// the parent achieved when every sub-goal is. Several landings can call this at once, so each
	// sub-goal is chosen from fresh state and marked started before anything awaits: two calls
	// can never start the same one.
	async advancePlan(goalId: string) {
		const row = this.db.exec("SELECT value FROM meta WHERE key = ?", `plan:${goalId}`).toArray()[0];
		if (!row) return;
		const { agentModels, maxParallel } = readPlanSettings(String(row.value), this.env.CODER_MODEL);
		const subgoals = () =>
			this.db
				.exec("SELECT id, status FROM goals WHERE parent_id = ? ORDER BY created_at", goalId)
				.toArray()
				.map((c) => ({
					id: String(c.id),
					status: String(c.status),
					dependsOn: this.db.exec("SELECT depends_on FROM goal_deps WHERE goal_id = ?", String(c.id)).toArray().map((r) => String(r.depends_on)),
				}));
		const all = subgoals();
		if (all.length === 0) return;
		if (all.every((c) => c.status === "achieved" || c.status === "abandoned")) {
			if (this.goal(goalId)?.status !== "achieved") this.setGoalStatus(goalId, "achieved");
			return;
		}
		if (this.goal(goalId)?.status === "planned") this.setGoalStatus(goalId, "in_progress");
		const order = all.map((c) => c.id);
		for (;;) {
			const next = nextSubgoal(subgoals(), maxParallel);
			if (!next) return;
			this.setGoalStatus(next, "in_progress"); // claimed: no await between choosing and this
			try {
				await this.assign(next, modelForSubgoal(agentModels, order.indexOf(next)));
			} catch (err) {
				this.setGoalStatus(next, "open");
				throw err;
			}
		}
	}

	goal(goalId: string): Goal | null {
		const row = this.db.exec("SELECT * FROM goals WHERE id = ?", goalId).toArray()[0];
		return row ? toGoal(row, this.repo) : null;
	}

	// ── Putting agents to work ───────────────────────────────────────────────

	// One agent, one fork, one change.
	async assign(goalId: string, model: string = this.env.CODER_MODEL, brief?: string, rewind?: string): Promise<Change> {
		const agentId = id("a");
		const change = await this.startChange({ goalId, agentId, model });
		await agentOf(this.ctx.exports, agentId).start({ repo: this.repo, changeId: change.id, brief, rewind });
		return change;
	}

	// Where a built-in agent's context window went.
	async attemptContext(changeId: string) {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent: its context isn't Hive's to see`);
		return JSON.parse(await agentOf(this.ctx.exports, change.agentId).context()) as ReturnType<typeof contextBreakdown>;
	}

	// The steps of a built-in agent's attempt, for rewinding.
	async attemptSteps(changeId: string) {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent: it has no steps Hive can rewind`);
		const messages = JSON.parse(await agentOf(this.ctx.exports, change.agentId).transcript()) as Msg[];
		return steps(messages);
	}

	// A fixing pass: carry on from the end of the attempt, told to resolve what its review raised and what
	// reviewers commented. The fixing agent starts with the attempt's edits in place, so it patches
	// instead of redoing; the original attempt is archived when the fix is started.
	async fixConcerns(changeId: string, opts: { model?: string; by?: string } = {}) {
		const detail = this.changeDetail(changeId);
		if (!detail) throw new Error(`unknown change ${changeId}`);
		const review = detail.evaluations.filter((e) => e.model !== "hive:evidence").at(-1);
		const concerns = review?.concerns ?? [];
		const unsent = detail.comments.filter((c) => c.sentAt === null);
		if (concerns.length === 0 && unsent.length === 0) throw new Error("nothing to fix: the review raised no concerns and there are no comments");
		const total = (await this.attemptSteps(changeId)).length;
		const guidance = [
			"You are the fixing pass: the work is in place, and a review raised points to resolve. Change only what's needed for them, keep everything else, run the checks, and submit.",
			concerns.length ? `The review's concerns:\n${concerns.map((c) => `- ${c}`).join("\n")}` : null,
			unsent.length ? `Reviewer comments:\n${feedback(unsent)}` : null,
		]
			.filter(Boolean)
			.join("\n\n");
		const change = await this.rewind(changeId, total, { model: opts.model, guidance, replace: true, by: opts.by ?? "fix" });
		if (unsent.length) this.db.exec(`UPDATE comments SET sent_at = ? WHERE id IN (${unsent.map(() => "?").join(",")})`, now(), ...unsent.map((c) => c.id));
		return change;
	}

	// Carry on from step N of an earlier attempt: a fresh fork with that attempt's edits redone and its
	// conversation as it was then, then a different instruction or model. Both attempts stay to compare.
	async rewind(changeId: string, step: number, opts: { model?: string; guidance?: string; replace?: boolean; by?: string } = {}) {
		const previous = this.changeDetail(changeId);
		if (!previous) throw new Error(`unknown change ${changeId}`);
		if (previous.change.status === "landed") throw new Error(`${changeId} already landed`);
		if (!this.isBuiltin(previous.change.agentId)) throw new Error(`${previous.change.agentId} is an external agent: it has no steps Hive can rewind`);
		const messages = JSON.parse(await agentOf(this.ctx.exports, previous.change.agentId).transcript()) as Msg[];
		const cut = rewind(messages, step);
		const after = steps(messages).slice(step);
		const last = previous.decisions.at(-1);
		const note = [
			step === 0
				? `You are starting over on a goal an earlier attempt (${changeId}, by ${previous.change.model}) didn't land. Nothing from it is in place.`
				: `You are carrying on from step ${step} of ${cut.total} of an earlier attempt (${changeId}, by ${previous.change.model}). Its file edits and declared intent up to there are in place in this workspace.`,
			after.length ? `It went on to: ${after.slice(0, 8).map((s) => `${s.step}. ${s.calls.join(", ") || "thinking"}`).join("; ")}.` : null,
			last ? `How it ended: ${last.rationale.slice(0, 500)}` : null,
			previous.comments.length ? `A reviewer's comments on it:\n${previous.comments.map((c) => `- ${c.path ? `${c.path}${c.line ? `:${c.line}` : ""}: ` : ""}${c.body}`).join("\n")}` : null,
			opts.guidance ? `Guidance now: ${opts.guidance}` : "Take a different approach from where it went wrong.",
			"Run the checks and submit when it's right.",
		]
			.filter(Boolean)
			.join("\n\n");
		if (opts.replace && !["landed", "archived"].includes(previous.change.status)) await this.abandon(changeId, opts.by ?? "rewind");
		const change = await this.assign(previous.change.goalId, opts.model ?? previous.change.model, undefined, JSON.stringify({ messages: cut.kept, replay: cut.replay, note }));
		this.log(change.agentId, `rewound ${changeId} to step ${step}${opts.model ? ` with ${opts.model}` : ""}`);
		return change;
	}

	// Try a goal again from a fresh fork: another model, a person's guidance, and what the earlier
	// attempt ran into. The earlier attempt stays for comparison unless `replace` archives it.
	async tryAgain(changeId: string, opts: { model?: string; guidance?: string; replace?: boolean; by?: string } = {}) {
		const previous = this.changeDetail(changeId);
		if (!previous) throw new Error(`unknown change ${changeId}`);
		if (previous.change.status === "landed") throw new Error(`${changeId} already landed`);
		if (previous.goal?.status === "achieved") throw new Error("its goal is already achieved");
		const last = previous.decisions.at(-1);
		const failed = previous.evidence.filter((e) => !e.ok).map((e) => `${e.command}: ${e.output.slice(-400)}`);
		const brief = [
			`This goal was attempted before (${changeId}, by ${previous.change.model}) and didn't land.`,
			last ? `What happened: ${last.rationale.slice(0, 600)}` : null,
			failed.length ? `Checks that failed then:\n${failed.slice(0, 3).join("\n")}` : null,
			previous.comments.length ? `A reviewer's comments on it:\n${previous.comments.map((c) => `- ${c.path ? `${c.path}${c.line ? `:${c.line}` : ""}: ` : ""}${c.body}`).join("\n")}` : null,
			opts.guidance ? `Guidance for this attempt: ${opts.guidance}` : null,
			"Start from trunk; don't assume anything from the earlier attempt is present.",
		]
			.filter(Boolean)
			.join("\n\n");
		if (opts.replace && !["landed", "archived"].includes(previous.change.status)) await this.abandon(changeId, opts.by ?? "retry");
		const change = await this.assign(previous.change.goalId, opts.model ?? previous.change.model, brief);
		this.log(change.agentId, `retrying ${changeId}${opts.model ? ` with ${opts.model}` : ""}`);
		return change;
	}

	// Restart the agent on a change that is still in its hands (e.g. after a crash or a model outage).
	async restartAgent(changeId: string): Promise<Change> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		const stoppedBy = change.status === "escalated" ? this.changeDetail(changeId)?.decisions.at(-1)?.decidedBy : undefined;
		const budgetStop = stoppedBy === "hive:budget" || stoppedBy === "hive:agent";
		if (!["drafting", "bounced"].includes(change.status) && !budgetStop) throw new Error(`change ${changeId} is ${change.status}, not with its agent`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent; restart it yourself`);
		if (budgetStop) {
			const over = this.overBudget(change.goalId);
			if (over) throw new Error(`still over budget (${usd(over.spent)} of ${usd(over.limit)}): raise it first`);
			this.setStatus(changeId, "drafting");
		}
		await agentOf(this.ctx.exports, change.agentId).start({ repo: this.repo, changeId });
		this.log(change.agentId, "restarted");
		return change;
	}

	// Give up on a change: archive it and release its intent so it stops showing as an overlap.
	abandon(changeId: string, by: string): Change {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (["landed", "archived", "converging"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}`);
		this.releaseIntent(changeId);
		if (this.isBuiltin(change.agentId)) this.ctx.waitUntil(agentOf(this.ctx.exports, change.agentId).release().catch(() => {}));
		this.log(change.agentId, `abandoned by ${by}`);
		return this.setStatus(changeId, "archived");
	}

	// An external agent (MCP client, CLI user) claims a goal: it gets a fork plus short-lived
	// credentials to clone it and to read trunk, and drives the change with plain git.
	async claim(goalId: string, agentName: string, kind: "mcp" | "cli", model = "external") {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,60}$/.test(agentName)) throw new Error("agent name must be 2-61 letters, digits, '.', '_' or '-'");
		const change = await this.startChange({ goalId, agentId: agentName, model, kind });
		const host = repoHost(this.env);
		const [fork, trunk] = await Promise.all([host.get(change.fork), host.get(this.repo)]);
		const [forkToken, trunkToken] = await Promise.all([host.token(change.fork, "write", 3600), host.token(this.repo, "read", 3600)]);
		return {
			changeId: change.id,
			cloneRemote: authenticatedRemote(fork!.remote, forkToken),
			trunkRemote: authenticatedRemote(trunk!.remote, trunkToken),
		};
	}

	// N agents attempt the same goal in parallel forks; Clef judges the finished candidates.
	async race(goalId: string, models: string[]): Promise<{ group: string; changes: Change[] }> {
		const group = id("r");
		const changes: Change[] = [];
		for (const [index, model] of models.entries()) {
			const agentId = id("a");
			changes.push(await this.startChange({ goalId, agentId, model, race: { group, index } }));
		}
		await Promise.all(changes.map((c) => agentOf(this.ctx.exports, c.agentId).start({ repo: this.repo, changeId: c.id })));
		return { group, changes };
	}

	// ── Changes ──────────────────────────────────────────────────────────────

	// Fork trunk into a fresh repo for this change. The fork is the change's isolated workspace.
	async startChange(input: {
		goalId: string;
		agentId: string;
		model: string;
		race?: { group: string; index: number };
		kind?: AgentKind;
	}): Promise<Change> {
		const changeId = id("c");
		const genesis = await this.trunkHead();
		// Overlap checks need a current semantic index. Push events keep it fresh, but don't rely on them.
		if (genesis && this.indexStatus().commit !== genesis) await this.schedule(0, "reindex", { commit: genesis });
		const fork = changeRepo(this.repo, changeId);
		const forkStarted = Date.now();
		await this.forkPool().fork(fork, `Hive change ${changeId}`);
		this.recordMetric("fork_ms", Date.now() - forkStarted);
		this.ensureAgent(input.agentId, input.model, input.kind);

		const t = now();
		this.db.exec(
			`INSERT INTO changes (id, goal_id, fork, agent_id, model, status, genesis, head, race_group, race_index, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'drafting', ?, NULL, ?, ?, 0, ?, ?)`,
			changeId,
			input.goalId,
			fork,
			input.agentId,
			input.model,
			genesis,
			input.race?.group ?? null,
			input.race?.index ?? null,
			t,
			t,
		);
		if (this.goal(input.goalId)?.status === "open") this.setGoalStatus(input.goalId, input.race ? "racing" : "in_progress");
		const change = this.change(changeId)!;
		this.emit({ type: "change", change });
		return change;
	}

	// Trunk's head, cached: updated on every landing and trunk push instead of asked for per fork.
	private async trunkHead(): Promise<string> {
		const cached = this.db.exec("SELECT value FROM meta WHERE key = 'trunk_head'").toArray()[0];
		if (cached) return String(cached.value);
		const fresh = (await head(repoHost(this.env), this.repo)) ?? "";
		if (fresh) this.setTrunkHead(fresh);
		return fresh;
	}

	// Pushes to trunk from outside Hive (a person with plain git) arrive as Artifacts events when a
	// queue subscription is set up; without one, the heartbeat notices them here.
	private async noticeTrunkPushes() {
		const known = this.db.exec("SELECT value FROM meta WHERE key = 'trunk_head'").toArray()[0];
		if (!known) return; // nothing landed or forked yet: nothing to compare with
		const log = await repoHost(this.env).log(this.repo, { limit: 20 });
		const latest = log[0]?.hash;
		if (!latest || latest === String(known.value)) return;
		const fresh = [];
		for (const c of log) {
			if (c.hash === String(known.value)) break;
			fresh.push({ id: c.hash, trailers: parseTrailers(c.message) });
		}
		await this.onTrunkPush(latest, fresh);
	}

	private setTrunkHead(commit: string) {
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('trunk_head', ?)", commit);
	}

	private pool: ForkPool | null = null;
	private forkPool(): ForkPool {
		this.pool ??= new ForkPool(repoHost(this.env), this.repo, {
			list: () => this.mirrors(),
			add: (name) => this.db.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", `mirror:${name}`, String(now())),
		});
		return this.pool;
	}

	mirrors(): string[] {
		return this.db
			.exec("SELECT key FROM meta WHERE key LIKE 'mirror:%' ORDER BY key")
			.toArray()
			.map((r) => String(r.key).slice("mirror:".length));
	}

	change(changeId: string): Change | null {
		const row = this.db.exec("SELECT * FROM changes WHERE id = ?", changeId).toArray()[0];
		return row ? toChange(row, this.repo) : null;
	}

	private setStatus(changeId: string, status: ChangeStatus, extra: { head?: string } = {}) {
		if (extra.head) this.db.exec("UPDATE changes SET head = ? WHERE id = ?", extra.head, changeId);
		this.db.exec("UPDATE changes SET status = ?, updated_at = ? WHERE id = ?", status, now(), changeId);
		const change = this.change(changeId)!;
		this.emit({ type: "change", change });
		if (status === "escalated") {
			const goal = this.goal(change.goalId);
			this.notify({ event: "needs-you", text: `${changeId} (“${goal?.title ?? change.goalId}”) needs a person to land it or send it back.`, changeId, goalId: change.goalId });
		}
		return change;
	}

	// ── Intents ──────────────────────────────────────────────────────────────

	async declareIntent(changeId: string, raw: { summary: string; paths: string[]; symbols: SymbolRef[] }): Promise<IntentResult> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		// Paths as the code graph knows them (relative to the repository root): agents sometimes send
		// their workspace path, which would never match anyone else's intent.
		const input = { ...raw, paths: [...new Set(raw.paths.map(cleanPath))], symbols: raw.symbols.map((s) => ({ ...s, path: cleanPath(s.path) })) };
		// A change holds one live intent; re-declaring replaces it (scope narrowed or widened).
		this.intents.release(changeId, now());

		const intent: Intent = {
			id: id("i"),
			changeId,
			agentId: change.agentId,
			summary: input.summary,
			paths: input.paths,
			symbols: input.symbols,
			createdAt: now(),
			releasedAt: null,
		};
		this.intents.insert(intent);

		// Race candidates deliberately overlap each other; only compare against other goals' work.
		const graph = this.referenceGraph();
		const candidates = this.intents.candidates(intent, graph).filter((i) => {
			if (!change.race) return true;
			return this.change(i.changeId)?.race?.group !== change.race.group;
		});
		const overlaps = detectOverlaps(intent, candidates, graph);
		let advice: IntentResult["advice"] = null;
		if (overlaps.length > 0) {
			advice = await adviseOnOverlap(this.clef("overlap", change.id), { mine: intent.summary, overlaps }).catch((err) => {
				console.warn("clef overlap advice failed", err);
				return null;
			});
		}
		this.emit({ type: "intent", intent, overlaps });
		// Overlap is mutual: tell the agents who declared first, too.
		for (const o of overlaps) {
			if (!this.isBuiltin(o.otherAgentId)) continue;
			const note = `Heads-up from Hive: ${intent.agentId} (${changeId}) now intends to "${intent.summary}". That ${o.level}ly overlaps your work: ${o.detail.join("; ")}. Coordinate with message_agent if needed.`;
			this.ctx.waitUntil(agentOf(this.ctx.exports, o.otherAgentId).receiveMessage("hive", note).catch(() => {}));
		}
		return { intent, overlaps, advice };
	}

	releaseIntent(changeId: string) {
		for (const intentId of this.intents.release(changeId, now())) this.emit({ type: "intent_released", intentId });
	}

	liveIntents(): Intent[] {
		return this.intents.live();
	}

	private intentFor(changeId: string): Intent | null {
		return this.intents.forChange(changeId);
	}

	referenceGraph(): ReferenceGraph & { dependenciesOf(s: SymbolRef): SymbolRef[] } {
		const rows = (sql: string, s: SymbolRef, pathCol: string, nameCol: string) =>
			this.db
				.exec(sql, s.path, s.name)
				.toArray()
				.map((r) => ({ path: String(r[pathCol]), name: String(r[nameCol]) }));
		return {
			dependentsOf: (s) => rows("SELECT from_path, from_name FROM refs WHERE to_path = ? AND to_name = ?", s, "from_path", "from_name"),
			dependenciesOf: (s) => rows("SELECT to_path, to_name FROM refs WHERE from_path = ? AND from_name = ?", s, "to_path", "to_name"),
		};
	}

	// ── Messaging between agents ─────────────────────────────────────────────

	// Messages to or from a change's agent, oldest first.
	messagesFor(changeId: string) {
		const change = this.change(changeId);
		if (!change) return [];
		return this.db
			.exec("SELECT from_agent, to_agent, text, created_at FROM messages WHERE from_agent = ? OR to_agent = ? ORDER BY created_at LIMIT 200", change.agentId, change.agentId)
			.toArray()
			.map((r) => ({ from: String(r.from_agent), to: String(r.to_agent), text: String(r.text), at: Number(r.created_at) }));
	}

	// A person steering a working agent: the message lands in its inbox, between steps.
	async steer(changeId: string, text: string, by: string) {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent: message it with hive_message`);
		if (!["drafting", "bounced"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}: its agent isn't working on it`);
		await this.message(`human:${by}`, change.agentId, text.slice(0, 4000));
		return this.messagesFor(changeId);
	}

	async message(from: string, to: string, text: string) {
		this.db.exec("INSERT INTO messages VALUES (?, ?, ?, ?, ?)", id("m"), from, to, text, now());
		this.emit({ type: "message", from, to, text });
		const target = this.db.exec("SELECT id FROM changes WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", to).toArray()[0];
		if (target && this.isBuiltin(to)) await agentOf(this.ctx.exports, to).receiveMessage(from, text);
	}

	log(agentId: string, text: string) {
		this.emit({ type: "log", agentId, text });
	}

	// ── Convergence queue ────────────────────────────────────────────────────

	// The agent says its fork is ready. Verify there is something new, then queue it.
	async submit(changeId: string): Promise<Change> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!["drafting", "bounced"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}`);
		const forkHead = await head(repoHost(this.env), change.fork);
		if (!forkHead || forkHead === change.genesis) throw new Error("nothing to submit: the fork has no new commits");

		this.db.exec("UPDATE changes SET attempts = attempts + 1, submitted_at = ? WHERE id = ?", now(), changeId);
		const submitted = this.setStatus(changeId, "submitted", { head: forkHead });
		if (submitted.race && !this.raceWon(changeId)) await this.startRaceEvaluation(submitted);
		else await this.pump();
		return submitted;
	}

	// Start the next batch if nothing is landing. One batch lands at a time, which keeps the
	// coordinator the single writer to trunk; batching is what makes that single writer fast.
	private pumping = false;

	// Up to PIPELINE_DEPTH landing batches run at once, each in its own merge box: while one holds the
	// trunk lease (stack, verify, push), the next is already fetching its forks. Only the lease holder
	// touches trunk, so the coordinator is still trunk's single writer.
	async pump() {
		if (this.pumping) return;
		this.pumping = true;
		try {
			for (;;) {
				const slots = this.activeSlots();
				if (slots.size >= PIPELINE_DEPTH) return;
				const { batchMax } = this.settings();
				const batch = selectBatch(this.queued(batchMax * 4), batchMax);
				if (batch.length === 0) return;
				const slot = [...Array(PIPELINE_DEPTH).keys()].find((s) => !slots.has(s))!;
				for (const id of batch) this.setStatus(id, "converging");
				this.recordMetric("batch_size", batch.length);
				await this.startLanding(batch, "land", slot);
			}
		} finally {
			this.pumping = false;
		}
	}

	// Merge-box slots in use by landing batches that still have changes in flight.
	private activeSlots(): Set<number> {
		const instances = this.db
			.exec("SELECT DISTINCT landing_instance AS i FROM changes WHERE status = 'converging' AND landing_mode = 'land' AND landing_instance IS NOT NULL")
			.toArray()
			.map((r) => String(r.i));
		const slots = new Set<number>();
		for (const i of instances) {
			const row = this.db.exec("SELECT value FROM meta WHERE key = ?", `slot:${i}`).toArray()[0];
			slots.add(row ? Number(row.value) : 0);
		}
		return slots;
	}

	// The trunk lease: whoever holds it may stack, verify and push. A holder whose batch is gone
	// (finished, crashed) loses it to the next asker.
	acquireLease(instanceId: string): boolean {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'trunk_lease'").toArray()[0];
		const holder = row ? String(row.value) : null;
		const alive = holder && this.db.exec("SELECT 1 FROM changes WHERE status = 'converging' AND landing_instance = ? LIMIT 1", holder).toArray().length > 0;
		if (holder && holder !== instanceId && alive) return false;
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('trunk_lease', ?)", instanceId);
		return true;
	}

	private releaseLease(instanceId: string) {
		this.db.exec("DELETE FROM meta WHERE key = 'trunk_lease' AND value = ?", instanceId);
		this.db.exec("DELETE FROM meta WHERE key = ?", `slot:${instanceId}`);
	}

	// The oldest queued changes, with the files their intents touch.
	private queued(limit: number) {
		return this.db
			.exec(
				`SELECT c.id, (SELECT json_group_array(t.path) FROM intent_targets t JOIN intents i ON i.id = t.intent_id
				                WHERE i.change_id = c.id AND i.released_at IS NULL) AS paths
				 FROM changes c WHERE c.status = 'submitted' AND (c.race_group IS NULL OR c.race_won = 1)
				 ORDER BY c.submitted_at LIMIT ?`,
				limit,
			)
			.toArray()
			.map((r) => ({ changeId: String(r.id), paths: JSON.parse(String(r.paths ?? "[]")) as string[] }));
	}

	queueOrder(limit = 200): { changeId: string; position: number }[] {
		return this.queued(limit).map((q, position) => ({ changeId: q.changeId, position }));
	}

	// Untested changes from a batch go back in line (keeping their place by submission time).
	requeue(changeIds: string[]) {
		for (const id of changeIds) if (this.change(id)?.status === "converging") this.setStatus(id, "submitted");
	}

	// Trunk fails verification on its own (someone pushed a breaking commit, or an earlier bug let one
	// through). Record it, say so, and slow the queue down until trunk is green again.
	markTrunkRed(info: { commit: string; output: string }) {
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('trunk_red', ?)", JSON.stringify({ ...info, since: now() }));
		this.log("hive", `trunk is red at ${info.commit.slice(0, 8)}: landings paused until it passes again`);
		this.notify({ event: "trunk-failing", text: `Trunk fails its checks at ${info.commit.slice(0, 8)}; landings are paused until it passes again.` });
		this.recordMetric("trunk_red", 1);
	}

	private trunkRed(): { commit: string; since: number } | null {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'trunk_red'").toArray()[0];
		return row ? JSON.parse(String(row.value)) : null;
	}

	private clearTrunkRed() {
		this.db.exec("DELETE FROM meta WHERE key = 'trunk_red'");
	}

	async batchFinished(instanceId?: string) {
		// Anything this batch left converging (it shouldn't, but a crash or bug must not strand a
		// change forever) goes back in line.
		if (instanceId) {
			this.recordBoxTime(instanceId);
			this.releaseLease(instanceId);
			const stranded = this.db.exec("SELECT id FROM changes WHERE status = 'converging' AND landing_instance = ?", instanceId).toArray();
			for (const r of stranded) this.setStatus(String(r.id), "submitted");
			if (stranded.length) this.log("hive", `${stranded.length} change(s) returned to the queue after batch ${instanceId}`);
		}
		// While trunk is red, re-check every two minutes instead of spinning through batches.
		if (this.trunkRed()) await this.schedule(120, "pump");
		else await this.pump();
	}

	// ── Race mode ────────────────────────────────────────────────────────────

	private async startRaceEvaluation(change: Change) {
		this.setStatus(change.id, "converging");
		await this.startLanding([change.id], "evaluate");
	}

	raceCandidates(group: string): Change[] {
		return this.db.exec("SELECT * FROM changes WHERE race_group = ? ORDER BY race_index", group).toArray().map((r) => toChange(r, this.repo));
	}

	// ── Results from the landing workflow ────────────────────────────────────

	recordEvidence(e: Omit<Evidence, "id" | "createdAt">): Evidence {
		const evidence: Evidence = { ...e, id: id("e"), createdAt: now(), output: e.output.slice(-8000) };
		this.db.exec(
			"INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			evidence.id,
			evidence.changeId,
			evidence.kind,
			evidence.command,
			evidence.ok ? 1 : 0,
			evidence.output,
			evidence.commit,
			evidence.createdAt,
		);
		this.emit({ type: "evidence", evidence });
		return evidence;
	}

	// ── Origin and issues ────────────────────────────────────────────────────

	origin(): { url: string; branch: string | null } | null {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'origin'").toArray()[0];
		return row ? JSON.parse(String(row.value)) : null;
	}

	goalIssue(goalId: string): { ref: string; url: string } | null {
		const r = this.db.exec("SELECT ref, url FROM goal_issues WHERE goal_id = ?", goalId).toArray()[0];
		return r ? { ref: String(r.ref), url: String(r.url) } : null;
	}

	// One goal per open GitHub issue, skipping issues already imported. The source defaults to the
	// repository this one was imported from. A token (for private repositories or rate limits) is
	// used for this call only.
	async importIssues(input: { source?: string; labels?: string[]; excludeLabels?: string[]; limit?: number; token?: string }) {
		const source = parseGitHubRepo(input.source ?? this.origin()?.url ?? "");
		if (!source) throw new Error(input.source ? `not a GitHub repository: ${input.source}` : "no source: pass owner/repo (this repository wasn't imported from GitHub)");
		const prefix = `${source.owner}/${source.repo}#`;
		const known = new Set(
			this.db
				.exec("SELECT ref FROM goal_issues WHERE ref LIKE ?", `${prefix}%`)
				.toArray()
				.map((r) => Number(String(r.ref).slice(prefix.length))),
		);
		const issues = await listOpenIssues(source, { token: input.token, labels: input.labels });
		const chosen = selectIssues(issues, { excludeLabels: input.excludeLabels, skip: known, limit: input.limit ?? 50 });
		const created = chosen.map((issue) => {
			const g = goalFromIssue(source, issue);
			const goal = this.createGoal({ title: g.title, description: g.description });
			this.db.exec("INSERT INTO goal_issues VALUES (?, ?, ?)", goal.id, g.ref, issue.url);
			return { goalId: goal.id, ref: g.ref, title: issue.title, url: issue.url };
		});
		this.log("hive", `imported ${created.length} issue(s) from ${source.owner}/${source.repo} as goals`);
		return { source: `${source.owner}/${source.repo}`, open: issues.length, alreadyImported: known.size, created };
	}

	// ── Recurring goals ──────────────────────────────────────────────────────

	listRecurring() {
		return this.db
			.exec("SELECT * FROM recurring ORDER BY created_at")
			.toArray()
			.map((r) => ({
				id: String(r.id),
				title: String(r.title),
				description: String(r.description),
				everyMinutes: Number(r.every_minutes),
				every: describeEvery(Number(r.every_minutes)),
				mode: String(r.mode) as "one" | "plan" | "race",
				models: JSON.parse(String(r.models)) as string[],
				budget: r.budget === null ? null : Number(r.budget),
				enabled: Number(r.enabled) === 1,
				nextRun: Number(r.next_run),
				lastGoal: r.last_goal ? String(r.last_goal) : null,
				lastGoalStatus: r.last_goal ? (this.goal(String(r.last_goal))?.status ?? null) : null,
				runs: Number(r.runs),
			}));
	}

	addRecurring(input: { title: string; description?: string; every: string; mode?: "one" | "plan" | "race"; models?: string[]; budget?: number | null }) {
		const minutes = parseEvery(input.every);
		if (!minutes) throw new Error(`"${input.every}": use hourly, daily, weekly, or a number like 6h, 2d (at least an hour)`);
		const mode = input.mode ?? "one";
		if (mode === "race" && (input.models?.length ?? 0) < 2) throw new Error("a race needs at least two models");
		const rid = id("r");
		this.db.exec(
			"INSERT INTO recurring (id, title, description, every_minutes, mode, models, budget, enabled, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
			rid,
			input.title,
			input.description ?? "",
			minutes,
			mode,
			JSON.stringify(input.models ?? []),
			input.budget && input.budget > 0 ? input.budget : null,
			nextAfter(now(), minutes),
			now(),
		);
		return this.listRecurring().find((r) => r.id === rid)!;
	}

	setRecurring(recurringId: string, patch: { enabled?: boolean; remove?: boolean }) {
		if (patch.remove) this.db.exec("DELETE FROM recurring WHERE id = ?", recurringId);
		else if (patch.enabled !== undefined) this.db.exec("UPDATE recurring SET enabled = ? WHERE id = ?", patch.enabled ? 1 : 0, recurringId);
		return this.listRecurring();
	}

	// Start one run: a new goal, with its agents. `force` runs it now even if the last one is going.
	async runRecurring(recurringId: string, force = false) {
		const row = this.listRecurring().find((r) => r.id === recurringId);
		if (!row) throw new Error(`no recurring goal ${recurringId}`);
		if (!force && row.lastGoalStatus && ["open", "in_progress", "planning", "planned", "racing"].includes(row.lastGoalStatus)) {
			this.db.exec("UPDATE recurring SET next_run = ? WHERE id = ?", nextAfter(now(), row.everyMinutes), recurringId);
			return { skipped: true as const, reason: `the last run (${row.lastGoal}) is still ${row.lastGoalStatus}` };
		}
		const stamp = new Date().toISOString().slice(0, 10);
		const goal = this.createGoal({ title: `${row.title} (${stamp})`, description: row.description });
		if (row.budget) this.setGoalBudget(goal.id, row.budget);
		this.db.exec("UPDATE recurring SET last_goal = ?, runs = runs + 1, next_run = ? WHERE id = ?", goal.id, nextAfter(now(), row.everyMinutes), recurringId);
		this.log("hive", `recurring “${row.title}” started ${goal.id}`);
		try {
			if (row.mode === "plan") await this.plan(goal.id, { agentModels: row.models.length ? row.models : undefined });
			else if (row.mode === "race") await this.race(goal.id, row.models);
			else await this.assign(goal.id, row.models[0]);
		} catch (err) {
			this.log("hive", `recurring “${row.title}”: ${goal.id} created but no agent started (${(err as Error).message})`);
		}
		return { skipped: false as const, goalId: goal.id };
	}

	private async runDueRecurring() {
		const rows = this.listRecurring();
		const { run, skipped } = dueNow(rows.map((r) => ({ id: r.id, enabled: r.enabled, everyMinutes: r.everyMinutes, nextRun: r.nextRun, lastGoalStatus: r.lastGoalStatus })), now());
		for (const rid of skipped) this.db.exec("UPDATE recurring SET next_run = ? WHERE id = ?", nextAfter(now(), rows.find((r) => r.id === rid)!.everyMinutes), rid);
		for (const rid of run) await this.runRecurring(rid).catch((e) => console.warn("recurring run failed", e));
	}

	// ── GitHub: mirror trunk, a pull request per goal, bring upstream in ─────

	private githubConfig(): GitHubConfig | null {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'github'").toArray()[0];
		return row ? JSON.parse(String(row.value)) : null;
	}

	private saveGithub(cfg: GitHubConfig | null) {
		if (cfg) this.db.exec("INSERT OR REPLACE INTO meta VALUES ('github', ?)", JSON.stringify(cfg));
		else this.db.exec("DELETE FROM meta WHERE key = 'github'");
	}

	private get secretMaster() {
		return (this.env as { HIVE_TOKEN?: string }).HIVE_TOKEN || "hive-devhost-secret";
	}

	// For the outbound gateway only: the token, decrypted when a sandbox talks to GitHub.
	async githubToken(): Promise<string | null> {
		const cfg = this.githubConfig();
		return cfg ? openSecret(this.secretMaster, cfg.token) : null;
	}

	async connectGitHub(input: { token: string; remote?: string; mirror?: boolean; prs?: boolean; pull?: boolean; branch?: string }) {
		const target = parseGitHubRepo(input.remote ?? this.origin()?.url ?? "");
		if (!target) throw new Error(input.remote ? `not a GitHub repository: ${input.remote}` : "which GitHub repository? pass remote (this one wasn't imported from GitHub)");
		const info = await gh<{ default_branch: string; permissions?: { push?: boolean } }>(`/repos/${target.owner}/${target.repo}`, input.token);
		if (!info.permissions?.push) throw new Error(`that token can't push to ${target.owner}/${target.repo}: it needs Contents and Pull requests (read and write)`);
		// Goals already achieved get no pull request: only work from here on goes to GitHub.
		for (const r of this.db.exec("SELECT id FROM goals WHERE status = 'achieved' AND parent_id IS NULL").toArray()) {
			this.db.exec("INSERT OR IGNORE INTO goal_prs (goal_id, state, reason, updated_at) VALUES (?, 'skipped', 'achieved before GitHub was connected', ?)", String(r.id), now());
		}
		const previous = this.githubConfig();
		const sameRepo = previous && previous.owner === target.owner && previous.repo === target.repo;
		const cfg: GitHubConfig = {
			owner: target.owner,
			repo: target.repo,
			base: info.default_branch,
			branch: input.branch ?? "hive/main",
			mirror: input.mirror ?? true,
			prs: input.prs ?? true,
			pull: input.pull ?? false,
			token: await sealSecret(this.secretMaster, input.token),
			connectedAt: now(),
			lastSynced: sameRepo ? previous.lastSynced : null,
			pendingSync: sameRepo ? previous.pendingSync : null,
			lastRun: null,
			lastMirror: null,
			lastPull: null,
			error: null,
		};
		this.saveGithub(cfg);
		this.log("hive", `connected to github.com/${cfg.owner}/${cfg.repo}`);
		await this.schedule(1, "githubSync");
		return this.githubStatus();
	}

	setGitHubOptions(patch: { mirror?: boolean; prs?: boolean; pull?: boolean }) {
		const cfg = this.githubConfig();
		if (!cfg) throw new Error("not connected to GitHub");
		this.saveGithub({ ...cfg, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "boolean")) });
		return this.githubStatus();
	}

	disconnectGitHub() {
		this.saveGithub(null);
		this.log("hive", "disconnected from GitHub");
		return { connected: false };
	}

	githubStatus() {
		const cfg = this.githubConfig();
		const pullRequests = this.db
			.exec("SELECT goal_id, state, number, url, branch, reason, updated_at FROM goal_prs WHERE state != 'skipped' ORDER BY updated_at DESC LIMIT 100")
			.toArray()
			.map((r) => ({ goalId: String(r.goal_id), state: String(r.state), number: r.number === null ? null : Number(r.number), url: r.url ? String(r.url) : null, reason: r.reason ? String(r.reason) : null }));
		if (!cfg) return { connected: false as const, pullRequests };
		const { token: _token, ...rest } = cfg;
		return { connected: true as const, ...rest, repoUrl: `https://github.com/${cfg.owner}/${cfg.repo}`, pullRequests };
	}

	private githubSyncing = false;

	// Mirror trunk, open pull requests for newly achieved goals, and bring upstream commits in.
	// Runs after landings, on demand, and every ten minutes when pulling is on.
	async githubSync() {
		const cfg = this.githubConfig();
		if (!cfg || this.githubSyncing) return;
		this.githubSyncing = true;
		const box = mergeBoxOf(this.ctx.exports, `${this.repo}:github`);
		const where = { repo: this.repo, owner: cfg.owner, name: cfg.repo };
		const errors: string[] = [];
		const update: Partial<GitHubConfig> = { lastRun: now() };
		try {
			if (cfg.mirror) {
				const m = await box.githubMirror({ ...where, branch: cfg.branch }).catch((e: Error) => ({ ok: false, head: "", reason: e.message }));
				if (m.ok) update.lastMirror = { at: now(), head: m.head };
				else errors.push(`mirror: ${m.reason}`);
			}
			if (cfg.prs) await this.openGoalPrs(cfg, box, where).catch((e: Error) => errors.push(`pull requests: ${e.message}`));
			if (cfg.pull) {
				const p = await this.pullUpstream(cfg, box, where).catch((e: Error) => {
					errors.push(`pull: ${e.message}`);
					return null;
				});
				if (p) Object.assign(update, p);
			}
		} finally {
			this.githubSyncing = false;
			const latest = this.githubConfig();
			if (latest) this.saveGithub({ ...latest, ...update, error: errors.length ? errors.join("; ").slice(0, 1000) : null });
		}
	}

	private async openGoalPrs(cfg: GitHubConfig, box: ReturnType<typeof mergeBoxOf>, where: { repo: string; owner: string; name: string }) {
		const token = await this.githubToken();
		if (!token) throw new Error("the stored token can't be read (was HIVE_TOKEN rotated? connect again)");
		const pending = this.db
			.exec("SELECT g.id FROM goals g LEFT JOIN goal_prs p ON p.goal_id = g.id WHERE g.status = 'achieved' AND g.parent_id IS NULL AND p.goal_id IS NULL ORDER BY g.created_at LIMIT 10")
			.toArray()
			.map((r) => String(r.id));
		for (const goalId of pending) {
			const goal = this.goal(goalId);
			if (!goal) continue;
			const subgoals = this.db.exec("SELECT id, title FROM goals WHERE parent_id = ? ORDER BY created_at", goalId).toArray();
			const goalIds = [goalId, ...subgoals.map((s) => String(s.id))];
			const branch = `hive/goal-${goalId}`;
			const result = await box.githubGoalBranch({ ...where, base: cfg.base, branch, goalIds });
			if (!result.ok || result.commits === 0) {
				const reason = result.ok ? "no landed commits for this goal" : (result.reason ?? "failed");
				this.db.exec("INSERT OR REPLACE INTO goal_prs VALUES (?, ?, NULL, NULL, ?, ?, ?)", goalId, result.ok ? "empty" : "conflict", branch, reason, now());
				continue;
			}
			const changes = goalIds.flatMap((g) =>
				this.db
					.exec("SELECT id FROM changes WHERE goal_id = ? AND status = 'landed'", g)
					.toArray()
					.map((r) => String(r.id)),
			);
			const issue = this.goalIssue(goalId);
			const prGoal: PrGoal = {
				id: goalId,
				title: goal.title,
				description: goal.description,
				issue,
				subgoals: subgoals.map((s) => ({ title: String(s.title) })),
				changes: changes.map((id) => {
					const d = this.changeDetail(id)!;
					const decision = d.decisions.filter((x) => x.outcome === "land" || x.outcome === "win").at(-1);
					return {
						id,
						model: d.change.model,
						evidence: d.evidence.map((e) => ({ command: e.command, ok: e.ok })),
						decision: decision ? { rationale: decision.rationale, decidedBy: decision.decidedBy, confidence: decision.confidence } : null,
						cost: this.changeCost(id).total,
					};
				}),
				dashboard: `${this.siteUrl()}/r/${encodeURIComponent(this.repo)}`,
			};
			const sameRepo = !!issue && issue.ref.toLowerCase().startsWith(`${cfg.owner}/${cfg.repo}#`.toLowerCase());
			const pr = await upsertPullRequest({ owner: cfg.owner, repo: cfg.repo }, token, { head: branch, base: cfg.base, title: prTitle(prGoal), body: prBody(prGoal, sameRepo) });
			this.db.exec("INSERT OR REPLACE INTO goal_prs VALUES (?, 'open', ?, ?, ?, NULL, ?)", goalId, pr.number, pr.url, branch, now());
			this.log("hive", `opened ${pr.url} for "${goal.title}"`);
		}
	}

	private async pullUpstream(cfg: GitHubConfig, box: ReturnType<typeof mergeBoxOf>, where: { repo: string; owner: string; name: string }): Promise<Partial<GitHubConfig>> {
		// One sync at a time: wait while the last one is still on its way to trunk.
		const open = this.db.exec("SELECT id FROM changes WHERE agent_id = ? AND status NOT IN ('landed','archived','escalated')", UPSTREAM_AGENT).toArray();
		if (open.length) return { lastPull: { at: now(), count: 0 } };
		const up = await box.githubUpstream({ ...where, base: cfg.base, since: cfg.lastSynced });
		const since = cfg.lastSynced ?? up.since;
		if (up.count === 0) return { lastSynced: since, lastPull: { at: now(), count: 0 } };
		const goal = this.createGoal({ title: `Sync ${up.count} commit${up.count === 1 ? "" : "s"} from GitHub`, description: `github.com/${cfg.owner}/${cfg.repo} ${cfg.base}: ${since.slice(0, 8)}..${up.upstreamHead.slice(0, 8)}` });
		const change = await this.startChange({ goalId: goal.id, agentId: UPSTREAM_AGENT, model: "upstream", kind: "cli" });
		const message = `Sync ${up.count} commit(s) from github.com/${cfg.owner}/${cfg.repo}\n\nUpstream ${since}..${up.upstreamHead}\n\nHive-Change-Id: ${change.id}\nHive-Goal: ${goal.id}\nHive-Agent: ${UPSTREAM_AGENT}\nHive-Model: upstream\nHive-Upstream: ${up.upstreamHead}\n`;
		const applied = await box.githubApplyUpstream({ ...where, base: cfg.base, fork: change.fork, since, upstreamHead: up.upstreamHead, message });
		if (!applied.ok) {
			await this.escalated(change.id, { confidence: 1, probabilities: { escalate: 1 }, rationale: `Couldn't bring GitHub's changes in: ${applied.reason}. Resolve on GitHub or in trunk, then abandon this change; the next sync retries.`, decidedBy: "hive:upstream" }, { pump: false });
			return { lastPull: { at: now(), count: up.count } };
		}
		await this.submit(change.id);
		this.log("hive", `bringing in ${up.count} commit(s) from GitHub as ${change.id}`);
		return { pendingSync: { changeId: change.id, upstreamHead: up.upstreamHead }, lastSynced: since, lastPull: { at: now(), count: up.count } };
	}

	private siteUrl() {
		return (this.env as { HIVE_SITE_URL?: string }).HIVE_SITE_URL || "https://hivegit.dev";
	}

	// ── Provenance ───────────────────────────────────────────────────────────

	// Why a line of trunk is what it is: the commit that last changed it, and, when Hive landed it,
	// the goal, the agent's declared intent, the evidence and the decision behind it.
	async why(path: string, line: number) {
		const blame = await mergeBoxOf(this.ctx.exports, `${this.repo}:checks`).blame({ repo: this.repo, path, line });
		if (!blame) return { path, line, found: false as const };
		const trailers = parseTrailers(blame.message);
		const changeId = trailers["Hive-Change-Id"];
		const detail = changeId ? this.changeDetail(changeId) : null;
		const base = { path, line, found: true as const, text: blame.text, commit: blame.commit, author: blame.author, at: blame.at * 1000, subject: blame.message.split("\n")[0] };
		if (!detail) return { ...base, hive: null };
		const decision = detail.decisions.filter((d) => d.outcome === "land" || d.outcome === "win").at(-1) ?? detail.decisions.at(-1) ?? null;
		return {
			...base,
			hive: {
				changeId,
				goal: detail.goal ? { id: detail.goal.id, title: detail.goal.title, description: detail.goal.description.slice(0, 1000) } : null,
				issue: detail.issue,
				model: detail.change.model,
				agent: detail.change.agentId,
				intent: detail.intent ? { summary: detail.intent.summary, symbols: detail.intent.symbols.map((s) => `${s.path}#${s.name}`) } : null,
				evidence: detail.evidence.map((e) => ({ kind: e.kind, command: e.command, ok: e.ok })),
				review: detail.evaluations.at(-1)?.summary ?? null,
				decision: decision ? { outcome: decision.outcome, rationale: decision.rationale, decidedBy: decision.decidedBy, confidence: decision.confidence } : null,
				comments: detail.comments.map((c) => c.body),
				transcript: this.isBuiltin(detail.change.agentId) ? `/api/agents/${detail.change.agentId}/transcript` : null,
			},
		};
	}

	// ── History ──────────────────────────────────────────────────────────────

	history(limit = 40) {
		const goals = this.db.exec("SELECT id, title, status, parent_id, created_at FROM goals").toArray().map((r) => ({
			id: String(r.id),
			title: String(r.title),
			status: String(r.status),
			parentId: r.parent_id ? String(r.parent_id) : null,
			createdAt: Number(r.created_at),
		}));
		const changes = this.db.exec("SELECT id, goal_id, model, status, created_at, submitted_at FROM changes").toArray().map((r) => ({
			id: String(r.id),
			goalId: String(r.goal_id),
			model: String(r.model),
			status: String(r.status),
			createdAt: Number(r.created_at),
			submittedAt: r.submitted_at === null ? null : Number(r.submitted_at),
		}));
		const decisions = this.db.exec("SELECT change_id, outcome, decided_by, rationale, created_at FROM decisions").toArray().map((r) => ({
			changeId: String(r.change_id),
			outcome: String(r.outcome),
			decidedBy: String(r.decided_by),
			rationale: String(r.rationale),
			createdAt: Number(r.created_at),
		}));
		const prs = Object.fromEntries(this.db.exec("SELECT goal_id, number, url FROM goal_prs WHERE url IS NOT NULL").toArray().map((r) => [String(r.goal_id), { number: Number(r.number), url: String(r.url) }]));
		const costByGoal = Object.fromEntries(this.db.exec("SELECT goal_id, SUM(cost) AS c FROM usage WHERE goal_id IS NOT NULL GROUP BY goal_id").toArray().map((r) => [String(r.goal_id), Number(r.c)]));
		return provenance({ goals, changes, decisions, prs, costByGoal, limit });
	}

	// ── Lessons: what reviewers asked for, remembered ────────────────────────

	listLessons() {
		return this.db
			.exec("SELECT * FROM lessons ORDER BY created_at DESC LIMIT 200")
			.toArray()
			.map((r) => ({ id: String(r.id), text: String(r.text), source: String(r.source), changeId: r.change_id ? String(r.change_id) : null, active: Number(r.active) === 1, createdAt: Number(r.created_at) }));
	}

	// For an agent's briefing: the most recent active lessons.
	lessonsFor(): string[] {
		return this.listLessons().filter((l) => l.active).slice(0, 12).map((l) => l.text);
	}

	addLesson(text: string, source = "manual", changeId: string | null = null) {
		const clean = text.replace(/\s+/g, " ").trim().slice(0, 400);
		if (clean.length < 8) return this.listLessons();
		// The same lesson twice is one lesson.
		if (this.listLessons().some((l) => l.text.toLowerCase() === clean.toLowerCase())) return this.listLessons();
		this.db.exec("INSERT INTO lessons VALUES (?, ?, ?, ?, 1, ?)", id("l"), clean, source, changeId, now());
		return this.listLessons();
	}

	setLesson(lessonId: string, patch: { active?: boolean; remove?: boolean }) {
		if (patch.remove) this.db.exec("DELETE FROM lessons WHERE id = ?", lessonId);
		else if (patch.active !== undefined) this.db.exec("UPDATE lessons SET active = ? WHERE id = ?", patch.active ? 1 : 0, lessonId);
		return this.listLessons();
	}

	// ── Review comments ──────────────────────────────────────────────────────

	comments(changeId: string): ReviewComment[] {
		return this.db
			.exec("SELECT * FROM comments WHERE change_id = ? ORDER BY created_at", changeId)
			.toArray()
			.map((r) => ({
				id: String(r.id),
				changeId: String(r.change_id),
				path: r.path === null ? null : String(r.path),
				line: r.line === null ? null : Number(r.line),
				side: String(r.side) === "old" ? "old" : "new",
				excerpt: r.excerpt === null ? null : String(r.excerpt),
				body: String(r.body),
				author: String(r.author),
				createdAt: Number(r.created_at),
				sentAt: r.sent_at === null ? null : Number(r.sent_at),
			}));
	}

	addComment(input: { changeId: string; path?: string | null; line?: number | null; side?: "new" | "old"; excerpt?: string | null; body: string; author: string }) {
		if (!this.change(input.changeId)) throw new Error(`unknown change ${input.changeId}`);
		const comment = { id: id("rc"), ...input };
		this.db.exec(
			"INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
			comment.id,
			input.changeId,
			input.path ?? null,
			input.line ?? null,
			input.side ?? "new",
			input.excerpt?.slice(0, 500) ?? null,
			input.body.slice(0, 4000),
			input.author,
			now(),
		);
		this.emit({ type: "comment", changeId: input.changeId });
		return this.comments(input.changeId);
	}

	deleteComment(changeId: string, commentId: string) {
		this.db.exec("DELETE FROM comments WHERE id = ? AND change_id = ? AND sent_at IS NULL", commentId, changeId);
		return this.comments(changeId);
	}

	// Send the pending comments to the change's agent as one round of feedback: a change waiting
	// for a person goes back to its agent; an agent still working gets them in its inbox.
	async sendComments(changeId: string, by: string) {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		const pending = this.comments(changeId).filter((c) => c.sentAt === null);
		if (!pending.length) throw new Error("no comments to send");
		const text = feedback(pending);
		if (change.status === "escalated") await this.humanDecision(changeId, "bounce", by, text);
		else if (["drafting", "bounced"].includes(change.status) && this.isBuiltin(change.agentId)) await this.message(`human:${by}`, change.agentId, text);
		else if (["drafting", "bounced"].includes(change.status)) this.log(change.agentId, `review comments waiting (read them with hive_change): ${pending.length}`);
		else throw new Error(`change ${changeId} is ${change.status}: comments can go to its agent while it's working or waiting for a person`);
		this.db.exec(`UPDATE comments SET sent_at = ? WHERE id IN (${pending.map(() => "?").join(",")})`, now(), ...pending.map((c) => c.id));
		// Delivered: what the reviewer asked for is worth remembering for the next agent.
		for (const c of pending) this.addLesson(`${c.path ? `(${c.path}) ` : ""}${c.body}`, "review", changeId);
		this.emit({ type: "comment", changeId });
		return { sent: pending.length, comments: this.comments(changeId) };
	}

	// ── Notifications ────────────────────────────────────────────────────────

	private hooks(): Hook[] {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'hooks'").toArray()[0];
		return row ? JSON.parse(String(row.value)) : [];
	}

	private saveHooks(hooks: Hook[]) {
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('hooks', ?)", JSON.stringify(hooks));
	}

	// Webhook URLs are often secrets themselves (Slack's, Discord's), so lists show only their host.
	listHooks() {
		return this.hooks().map(({ secret: _s, url, ...h }) => ({ ...h, url: maskUrl(url) }));
	}

	// The signing secret is shown once, here; afterwards only the gateway-side copy exists.
	async addHook(input: { url: string; format?: Format; events?: NotifyEvent[] }) {
		const problem = checkUrl(input.url);
		if (problem) throw new Error(problem);
		const secret = `whsec_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
		const hook: Hook = {
			id: id("h"),
			url: input.url,
			format: input.format ?? formatFor(input.url),
			events: input.events?.length ? input.events : [...EVENTS],
			secret: await sealSecret(this.secretMaster, secret),
			createdAt: now(),
			last: null,
		};
		this.saveHooks([...this.hooks(), hook]);
		const { secret: _s, url, ...shown } = hook;
		return { ...shown, url: maskUrl(url), signingSecret: hook.format === "json" ? secret : null };
	}

	removeHook(hookId: string) {
		this.saveHooks(this.hooks().filter((h) => h.id !== hookId));
		return this.listHooks();
	}

	async testHook(hookId: string) {
		const hook = this.hooks().find((h) => h.id === hookId);
		if (!hook) throw new Error(`no webhook ${hookId}`);
		return this.deliver(hook, { event: "needs-you", repo: this.repo, text: "This is a test from Hive.", link: `${this.siteUrl()}/r/${encodeURIComponent(this.repo)}`, at: now() }, 1);
	}

	private notify(n: Omit<Notice, "repo" | "link" | "at">) {
		const hooks = this.hooks().filter((h) => h.events.includes(n.event));
		if (!hooks.length) return;
		const notice: Notice = { ...n, repo: this.repo, link: `${this.siteUrl()}/r/${encodeURIComponent(this.repo)}`, at: now() };
		for (const h of hooks) this.ctx.waitUntil(this.deliver(h, notice, 3).catch(() => {}));
	}

	// Up to `tries` attempts, backing off; the outcome is kept on the hook for the settings panel.
	private async deliver(hook: Hook, n: Notice, tries: number) {
		if (hook.format === "email") return this.deliverEmail(hook, n);
		const body = payload(hook.format, n);
		const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "hive-webhooks", "x-hive-event": n.event };
		if (hook.format === "json") {
			const secret = await openSecret(this.secretMaster, hook.secret);
			if (secret) headers["x-hive-signature-256"] = await sign(secret, body);
		}
		let last: Hook["last"] = null;
		for (let i = 0; i < tries; i++) {
			if (i > 0) await new Promise((r) => setTimeout(r, 1000 * 4 ** i));
			try {
				const res = await fetch(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
				last = { at: now(), ok: res.ok, status: res.status, error: res.ok ? null : (await res.text()).slice(0, 200) };
				if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) break;
			} catch (err) {
				last = { at: now(), ok: false, status: null, error: String((err as Error)?.message ?? err).slice(0, 200) };
			}
		}
		this.saveHooks(this.hooks().map((h) => (h.id === hook.id ? { ...h, last } : h)));
		return last;
	}

	// Email goes out through the send-email binding, to an address verified in Email Routing.
	private async deliverEmail(hook: Hook, n: Notice) {
		const env = this.env as { EMAIL?: SendEmail; EMAIL_FROM?: string };
		let last: Hook["last"];
		if (!env.EMAIL || !env.EMAIL_FROM) last = { at: now(), ok: false, status: null, error: "email isn't set up on this deployment (HIVE_EMAIL_FROM)" };
		else {
			try {
				const { subject, text } = emailFor(n);
				await env.EMAIL.send({ from: { name: "Hive", email: env.EMAIL_FROM }, to: hook.url.slice(7), subject, text });
				last = { at: now(), ok: true, status: 200, error: null };
			} catch (err) {
				last = { at: now(), ok: false, status: null, error: String((err as Error)?.message ?? err).slice(0, 200) };
			}
		}
		this.saveHooks(this.hooks().map((h) => (h.id === hook.id ? { ...h, last } : h)));
		return last;
	}

	// ── Spend ────────────────────────────────────────────────────────────────

	// A batch's merge box time (standard-4), shared across its changes. Once per batch.
	private recordBoxTime(instanceId: string) {
		const key = `boxtime:${instanceId}`;
		if (this.db.exec("SELECT 1 FROM meta WHERE key = ?", key).toArray().length) return;
		const rows = this.db.exec("SELECT id, landing_started FROM changes WHERE landing_instance = ?", instanceId).toArray();
		const started = Math.min(...rows.map((r) => Number(r.landing_started ?? 0)).filter((n) => n > 0));
		if (!rows.length || !Number.isFinite(started)) return;
		this.db.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", key, String(now()));
		const seconds = Math.max(0, (now() - started) / 1000) / rows.length;
		for (const r of rows) this.recordUsage({ model: "container", purpose: "merge-box", changeId: String(r.id), seconds, instance: "standard-4" });
	}

	// Clef, with each call's tokens recorded against what it was deciding.
	private clef(purpose: string, changeId: string | null, goalId: string | null = null) {
		return metered(this.env.AI, (u) => this.recordUsage({ model: CLEF_MODEL, purpose, changeId, goalId, inputTokens: u.input_tokens, outputTokens: u.output_tokens }));
	}

	recordUsage(u: { model: string; purpose: string; changeId?: string | null; goalId?: string | null; agentId?: string | null; inputTokens?: number; outputTokens?: number; seconds?: number; instance?: string; costUsd?: number }) {
		const inputTokens = Math.max(0, Math.round(u.inputTokens ?? 0));
		const outputTokens = Math.max(0, Math.round(u.outputTokens ?? 0));
		const seconds = Math.max(0, u.seconds ?? 0);
		const cost = u.costUsd !== undefined ? u.costUsd : u.instance ? containerCost(u.instance, seconds) : modelCost(u.model, inputTokens, outputTokens);
		const goalId = u.goalId ?? (u.changeId ? (this.change(u.changeId)?.goalId ?? null) : null);
		this.db.exec(
			"INSERT INTO usage (at, model, purpose, change_id, goal_id, agent_id, input_tokens, output_tokens, seconds, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			now(),
			u.instance ? `container:${u.instance}` : u.model,
			u.purpose,
			u.changeId ?? null,
			goalId,
			u.agentId ?? null,
			inputTokens,
			outputTokens,
			seconds,
			cost,
		);
	}

	private goalNodes(): GoalNode[] {
		const budgets = new Map(this.db.exec("SELECT goal_id, budget FROM goal_budgets").toArray().map((r) => [String(r.goal_id), r.budget === null ? null : Number(r.budget)]));
		return this.db
			.exec("SELECT id, parent_id FROM goals")
			.toArray()
			.map((r) => ({ id: String(r.id), parentId: r.parent_id ? String(r.parent_id) : null, budget: budgets.get(String(r.id)) ?? null }));
	}

	private goalSpend(): Map<string, number> {
		const own = new Map(this.db.exec("SELECT goal_id, SUM(cost) AS c FROM usage WHERE goal_id IS NOT NULL GROUP BY goal_id").toArray().map((r) => [String(r.goal_id), Number(r.c)]));
		return treeSpend(this.goalNodes(), own);
	}

	setGoalBudget(goalId: string, budget: number | null) {
		if (!this.goal(goalId)) throw new Error(`unknown goal ${goalId}`);
		this.db.exec("INSERT OR REPLACE INTO goal_budgets VALUES (?, ?)", goalId, budget && budget > 0 ? budget : null);
		return { goalId, budget: budget && budget > 0 ? budget : null, spent: this.goalSpend().get(goalId) ?? 0 };
	}

	// The budget this goal's work has run into, if any.
	overBudget(goalId: string) {
		return budgetExceeded(goalId, this.goalNodes(), this.goalSpend(), this.settings().goalBudget);
	}

	// A built-in agent stopped without submitting: a person restarts it (perhaps with another model),
	// lands or sends back what it has, or abandons the change.
	async agentGaveUp(changeId: string, steps: number, reason: string | null) {
		const change = this.change(changeId);
		if (!change || !["drafting", "bounced"].includes(change.status)) return;
		const why = `The agent stopped after ${steps} step${steps === 1 ? "" : "s"} without submitting${reason ? ` (${reason.slice(0, 200)})` : ""}. Restart it, start another model on the goal, or abandon the change.`;
		this.log(change.agentId, why);
		await this.escalated(changeId, { confidence: 1, probabilities: { escalate: 1 }, rationale: why, decidedBy: "hive:agent" });
	}

	// What a goal may still spend before a budget stops it (the tightest one up its chain); null when none applies.
	budgetLeft(goalId: string): number | null {
		const goals = this.goalNodes();
		const spend = this.goalSpend();
		const byId = new Map(goals.map((g) => [g.id, g]));
		let left: number | null = null;
		const seen = new Set<string>();
		for (let n = byId.get(goalId); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
			seen.add(n.id);
			const limit = n.budget ?? (n.parentId === null ? this.settings().goalBudget : null);
			if (limit !== null) left = Math.min(left ?? Infinity, limit - (spend.get(n.id) ?? 0));
		}
		return left;
	}

	// An agent stopped by a budget: the change waits for a person, with the numbers.
	async budgetStopped(changeId: string) {
		const change = this.change(changeId);
		if (!change || !["drafting", "bounced"].includes(change.status)) return;
		const over = this.overBudget(change.goalId);
		const why = over
			? `Stopped at the budget: ${usd(over.spent)} spent of ${usd(over.limit)}${over.goalId === change.goalId ? "" : ` (goal ${over.goalId})`}. Raise the budget and restart the agent, or land or send back what it has.`
			: "Stopped at the budget.";
		this.log(change.agentId, why);
		await this.escalated(changeId, { confidence: 1, probabilities: { escalate: 1 }, rationale: why, decidedBy: "hive:budget" });
	}

	costs() {
		const rows = (sql: string) => this.db.exec(sql).toArray();
		const total = Number(rows("SELECT COALESCE(SUM(cost), 0) AS c FROM usage")[0].c);
		const byModel = rows("SELECT model, SUM(cost) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(seconds) AS seconds, COUNT(*) AS calls FROM usage GROUP BY model ORDER BY cost DESC").map((r) => ({
			model: String(r.model),
			cost: Number(r.cost),
			inputTokens: Number(r.input),
			outputTokens: Number(r.output),
			seconds: Number(r.seconds),
			calls: Number(r.calls),
		}));
		const byPurpose = Object.fromEntries(rows("SELECT purpose, SUM(cost) AS c FROM usage GROUP BY purpose").map((r) => [String(r.purpose), Number(r.c)]));
		const byChange = Object.fromEntries(rows("SELECT change_id, SUM(cost) AS c FROM usage WHERE change_id IS NOT NULL GROUP BY change_id").map((r) => [String(r.change_id), Number(r.c)]));
		const spend = this.goalSpend();
		const budgets = new Map(this.goalNodes().map((g) => [g.id, g.budget]));
		const byGoal = Object.fromEntries([...spend].filter(([g, c]) => c > 0 || (budgets.get(g) ?? null) !== null).map(([g, c]) => [g, { cost: c, budget: budgets.get(g) ?? null }]));
		return { total, byModel, byPurpose, byGoal, byChange, goalBudget: this.settings().goalBudget };
	}

	// How each model has done here: landings, sends-back, escalations, time and cost.
	models() {
		const changes = this.db
			.exec("SELECT id, model, status, created_at FROM changes")
			.toArray()
			.map((r) => ({ id: String(r.id), model: String(r.model), status: String(r.status), createdAt: Number(r.created_at) }));
		const decisions = this.db
			.exec("SELECT change_id, outcome, created_at FROM decisions")
			.toArray()
			.map((r) => ({ changeId: String(r.change_id), outcome: String(r.outcome), createdAt: Number(r.created_at) }));
		const cost = new Map(this.db.exec("SELECT change_id, SUM(cost) AS c FROM usage WHERE change_id IS NOT NULL GROUP BY change_id").toArray().map((r) => [String(r.change_id), Number(r.c)]));
		return leaderboard(changes, decisions, cost);
	}

	changeCost(changeId: string) {
		const rows = this.db.exec("SELECT model, purpose, SUM(cost) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(seconds) AS seconds FROM usage WHERE change_id = ? GROUP BY model, purpose", changeId).toArray();
		const parts = rows.map((r) => ({ model: String(r.model), purpose: String(r.purpose), cost: Number(r.cost), inputTokens: Number(r.input), outputTokens: Number(r.output), seconds: Number(r.seconds) }));
		return { total: parts.reduce((n, p) => n + p.cost, 0), parts };
	}

	recordDiff(changeId: string, d: { source: "agent" | "merge" | "cli"; base: string; head: string; diff: string }) {
		const truncated = d.diff.length > MAX_DIFF_CHARS;
		this.db.exec(
			"INSERT OR REPLACE INTO diffs VALUES (?, ?, ?, ?, ?, ?, ?)",
			changeId,
			d.source,
			d.base,
			d.head,
			truncated ? d.diff.slice(0, MAX_DIFF_CHARS) : d.diff,
			truncated ? 1 : 0,
			now(),
		);
	}

	diffOf(changeId: string): { source: string; base: string; head: string; diff: string; truncated: boolean; createdAt: number } | null {
		const r = this.db.exec("SELECT * FROM diffs WHERE change_id = ?", changeId).toArray()[0];
		if (!r) return null;
		return { source: String(r.source), base: String(r.base), head: String(r.head), diff: String(r.diff), truncated: Number(r.truncated) === 1, createdAt: Number(r.created_at) };
	}

	recordEvaluation(e: Omit<Evaluation, "id" | "createdAt">): Evaluation {
		const evaluation: Evaluation = { ...e, id: id("v"), createdAt: now() };
		this.db.exec(
			"INSERT INTO evaluations VALUES (?, ?, ?, ?, ?, ?, ?)",
			evaluation.id,
			evaluation.changeId,
			evaluation.model,
			evaluation.score,
			evaluation.summary,
			JSON.stringify(evaluation.concerns),
			evaluation.createdAt,
		);
		this.emit({ type: "evaluation", evaluation });
		return evaluation;
	}

	private recordDecision(d: Omit<Decision, "id" | "createdAt">): Decision {
		const decision: Decision = { ...d, id: id("d"), createdAt: now() };
		this.db.exec(
			"INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			decision.id,
			decision.changeId,
			decision.outcome,
			decision.confidence,
			JSON.stringify(decision.probabilities),
			decision.rationale,
			decision.decidedBy,
			decision.createdAt,
		);
		this.emit({ type: "decision", decision });
		this.markLedgerDirty(decision.changeId);
		return decision;
	}

	// ── Ledger: mirror the record of every decision into <repo>.hive ────────

	private markLedgerDirty(changeId: string) {
		this.db.exec("INSERT OR IGNORE INTO ledger_dirty VALUES (?)", changeId);
		const scheduled = this.db.exec("SELECT value FROM meta WHERE key = 'ledger_sync_scheduled'").toArray()[0];
		if (!scheduled) {
			this.db.exec("INSERT OR REPLACE INTO meta VALUES ('ledger_sync_scheduled', '1')");
			// Debounced: several decisions in quick succession become one ledger commit.
			this.ctx.waitUntil(this.schedule(3, "syncLedger"));
		}
	}

	async syncLedger() {
		this.db.exec("DELETE FROM meta WHERE key = 'ledger_sync_scheduled'");
		const dirty = this.db.exec("SELECT change_id FROM ledger_dirty").toArray().map((r) => String(r.change_id));
		if (dirty.length === 0) return;

		const files: LedgerFiles = {};
		const lines: string[] = [];
		for (const changeId of dirty) {
			const detail = this.changeDetail(changeId);
			if (!detail) continue;
			files[`changes/${changeId}.json`] = detail;
			if (detail.goal) files[`goals/${detail.goal.id}.json`] = detail.goal;
			const transcript = this.isBuiltin(detail.change.agentId)
				? await agentOf(this.ctx.exports, detail.change.agentId)
						.transcript()
						.catch(() => "[]")
				: "[]";
			files[`transcripts/${detail.change.agentId}.json`] = JSON.parse(transcript);
			const last = detail.decisions.at(-1);
			if (last) lines.push(`${changeId}: ${last.outcome} (${last.decidedBy}, ${Math.round(last.confidence * 100)}%)`);
		}
		files["agents.json"] = this.snapshot().agents;

		try {
			await writeLedger(repoHost(this.env), ledgerRepo(this.repo), files, `Ledger: ${dirty.length} change(s)\n\n${lines.join("\n")}`);
			for (const id of dirty) this.db.exec("DELETE FROM ledger_dirty WHERE change_id = ?", id);
		} catch (err) {
			console.error("ledger sync failed; will retry", err);
			this.db.exec("INSERT OR REPLACE INTO meta VALUES ('ledger_sync_scheduled', '1')");
			await this.schedule(30, "syncLedger");
		}
	}

	trust(agentId: string): number {
		const row = this.db.exec("SELECT trust FROM agents WHERE id = ?", agentId).toArray()[0];
		return row ? Number(row.trust) : 0.8;
	}

	private isBuiltin(agentId: string): boolean {
		const row = this.db.exec("SELECT kind FROM agents WHERE id = ?", agentId).toArray()[0];
		return !row || row.kind === "builtin";
	}

	private ensureAgent(agentId: string, model: string, kind: AgentKind = "builtin") {
		this.db.exec("INSERT OR IGNORE INTO agents VALUES (?, ?, ?, ?)", agentId, kind, model, kind === "builtin" || kind === "sim" ? 0.8 : 0.6);
	}

	private agentKind(agentId: string): AgentKind | null {
		const row = this.db.exec("SELECT kind FROM agents WHERE id = ?", agentId).toArray()[0];
		return row ? (String(row.kind) as AgentKind) : null;
	}

	// The Durable Object to notify about a change's fate: built-in coding agents and simulated
	// agents get callbacks; external agents (MCP, CLI) poll the change detail instead.
	private notifier(agentId: string) {
		const kind = this.agentKind(agentId);
		if (kind === "sim") return simOf(this.ctx.exports, agentId);
		if (kind === "builtin" || kind === null) return agentOf(this.ctx.exports, agentId);
		return null;
	}

	// ── Load testing ─────────────────────────────────────────────────────────

	// Spawn `agents` simulated agents in waves. Runs on alarms so the request returns immediately.
	async loadTest(opts: { agents: number; waveSize: number; sharedRate: number; brokenRate: number }) {
		const run = { ...opts, spawned: 0, startedAt: now(), id: id("lt") };
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('loadtest', ?)", JSON.stringify(run));
		await this.schedule(0, "loadTestWave");
		return run;
	}

	async loadTestWave() {
		const row = this.db.exec("SELECT value FROM meta WHERE key = 'loadtest'").toArray()[0];
		if (!row) return;
		const run = JSON.parse(String(row.value)) as { agents: number; waveSize: number; sharedRate: number; brokenRate: number; spawned: number; id: string };
		const count = Math.min(run.waveSize, run.agents - run.spawned);
		if (count <= 0) return;
		run.spawned += count;
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('loadtest', ?)", JSON.stringify(run));
		if (run.spawned < run.agents) await this.schedule(1, "loadTestWave");

		// Detached: a wave waits on forks, and scheduler callbacks must return quickly.
		this.ctx.waitUntil(this.keepAliveWhile(() => this.spawnWave(run, count)));
	}

	private async spawnWave(run: { sharedRate: number; brokenRate: number; spawned: number; id: string }, count: number) {
		await Promise.all(
			Array.from({ length: count }, async (_, i) => {
				const n = run.spawned - count + i;
				const r = Math.random();
				const kind = r < run.brokenRate ? "broken" : r < run.brokenRate + run.sharedRate ? "shared" : "disjoint";
				try {
					const goal = this.createGoal({ title: `Load ${run.id} #${n} (${kind})`, description: "Simulated agent" });
					const agentId = id("s");
					const change = await this.startChange({ goalId: goal.id, agentId, model: "sim", kind: "sim" });
					await simOf(this.ctx.exports, agentId).start({ repo: this.repo, changeId: change.id, kind });
				} catch (err) {
					this.recordMetric("spawn_error", 1);
					console.warn("load test spawn failed", err);
				}
			}),
		);
	}

	// A landing batch fast-forwarded trunk to `tip`; each change landed at its own commit in the stack.
	async landedBatch(items: { changeId: string; commit: string; decision: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome"> }[], tip: string) {
		for (const { changeId, commit, decision } of items) {
			const change = this.change(changeId);
			if (!change) continue;
			this.recordDecision({ ...decision, changeId, outcome: "land" });
			this.setStatus(changeId, "landed", { head: commit });
			this.releaseIntent(changeId);
			// Trust is earned: each clean landing nudges the agent up.
			this.db.exec("UPDATE agents SET trust = MIN(1.0, trust + 0.02) WHERE id = ?", change.agentId);
			this.emit({ type: "trunk", commit, changeId });
			if (this.db.exec("SELECT COUNT(*) AS n FROM changes WHERE goal_id = ? AND status NOT IN ('landed','archived')", change.goalId).one().n === 0) {
				this.setGoalStatus(change.goalId, "achieved");
			}
			const notify = this.notifier(change.agentId);
			if (notify) this.ctx.waitUntil(Promise.resolve(notify.onLanded(commit)).catch(() => {}));
		}
		this.recordMetric("landed", items.length);
		this.clearTrunkRed();
		this.setTrunkHead(tip);
		await this.schedule(0, "reindex", { commit: tip });
		const gh = this.githubConfig();
		if (gh) {
			if (gh.pendingSync && items.some((i) => i.changeId === gh.pendingSync?.changeId)) this.saveGithub({ ...gh, lastSynced: gh.pendingSync.upstreamHead, pendingSync: null });
			await this.schedule(20, "githubSync");
		}
	}

	async bounced(changeId: string, reason: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">, opts: { pump?: boolean } = {}) {
		const change = this.change(changeId)!;
		// Nobody can fix an upstream sync but a person.
		if (change.agentId === UPSTREAM_AGENT) {
			return this.escalated(changeId, { ...d, rationale: `GitHub's changes don't pass trunk's checks here: ${d.rationale}` }, opts);
		}
		this.recordDecision({ ...d, changeId, outcome: "bounce" });
		this.setStatus(changeId, "bounced");
		// External agents (MCP, CLI) read the reason from the change detail instead.
		const notify = this.notifier(change.agentId);
		if (notify) this.ctx.waitUntil(Promise.resolve(notify.onBounced(reason)).catch((err: unknown) => console.warn("bounce delivery failed", err)));
		if (opts.pump !== false) await this.pump();
	}

	async escalated(changeId: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">, opts: { pump?: boolean } = {}) {
		this.recordDecision({ ...d, changeId, outcome: "escalate" });
		this.setStatus(changeId, "escalated");
		if (d.decidedBy === "clef-flash" && this.settings().autoFix) this.ctx.waitUntil(this.autoFix(changeId).catch((e) => console.warn("auto fix failed", e)));
		if (opts.pump !== false) await this.pump();
	}

	// One automatic fixing pass per goal, only for a built-in agent's change that Clef wasn't sure
	// about, whose review raised concerns, and never past the goal's budget.
	private async autoFix(changeId: string) {
		const change = this.change(changeId);
		if (!change || !this.isBuiltin(change.agentId) || !change.model.startsWith("@cf/")) return;
		const key = `autofix:${change.goalId}`;
		if (this.db.exec("SELECT 1 FROM meta WHERE key = ?", key).toArray().length) return;
		const concerns = this.changeDetail(changeId)?.evaluations.filter((e) => e.model !== "hive:evidence").at(-1)?.concerns ?? [];
		if (concerns.length === 0 || this.overBudget(change.goalId)) return;
		this.db.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", key, changeId);
		this.log("hive", `auto fix: ${changeId} had ${concerns.length} concern(s) and Clef wasn't sure; starting a fixing pass`);
		await this.fixConcerns(changeId, { by: "auto" });
	}

	// Race candidate finished evaluation. When every candidate is done, Clef judges the race.
	async evaluated(changeId: string) {
		const change = this.setStatus(changeId, "evaluated");
		if (change.race) await this.judgeIfComplete(change.race.group, change.goalId);
	}

	private raceWon(changeId: string): boolean {
		return this.db.exec("SELECT race_won FROM changes WHERE id = ?", changeId).one().race_won === 1;
	}

	private async judgeIfComplete(group: string, goalId: string) {
		const candidates = this.raceCandidates(group);
		const stillRunning = candidates.some((c) => ["drafting", "submitted", "converging", "bounced"].includes(c.status));
		const finished = candidates.filter((c) => c.status === "evaluated");
		if (stillRunning || finished.length === 0) return;

		const goal = this.goal(goalId)!;
		const scored = finished.map((c) => {
			const detail = this.changeDetail(c.id)!;
			const review = detail.evaluations.at(-1);
			return {
				changeId: c.id,
				model: c.model,
				summary: detail.intent?.summary ?? review?.summary ?? "",
				diff: "",
				evidenceOk: detail.evidence.length > 0 && detail.evidence.every((e) => e.ok),
				reviewScore: review?.score ?? 0,
			};
		});
		const verdict =
			scored.length === 1
				? { winner: scored[0].changeId, confidence: 1, probabilities: { [scored[0].changeId]: 1 } }
				: await judgeRace(this.clef("judge", null, goal.id), `${goal.title}\n\n${goal.description}`, scored);

		for (const c of finished) {
			const won = c.id === verdict.winner;
			this.recordDecision({
				changeId: c.id,
				outcome: won ? "win" : "lose",
				confidence: verdict.probabilities[c.id] ?? 0,
				probabilities: verdict.probabilities,
				rationale: won ? `Race winner among ${finished.length} candidates.` : `Lost the race to ${verdict.winner}.`,
				decidedBy: "clef-flash",
			});
			if (won) {
				this.db.exec("UPDATE changes SET race_won = 1 WHERE id = ?", c.id);
				this.setStatus(c.id, "submitted");
			} else {
				this.setStatus(c.id, "archived");
				this.releaseIntent(c.id);
				if (this.isBuiltin(c.agentId)) this.ctx.waitUntil(agentOf(this.ctx.exports, c.agentId).release().catch(() => {}));
			}
		}
		const winner = finished.find((c) => c.id === verdict.winner);
		this.notify({ event: "race-finished", text: `The race for “${goal.title}” finished: ${winner ? `${winner.model} won` : "no winner"} among ${finished.length}.`, goalId: goal.id, changeId: verdict.winner });
		await this.pump();
	}

	// A human overrides the race judge.
	async pickRaceWinner(group: string, changeId: string, by: string) {
		const candidates = this.raceCandidates(group);
		const winner = candidates.find((c) => c.id === changeId);
		if (!winner) throw new Error(`${changeId} is not in race ${group}`);
		for (const c of candidates) {
			if (c.id === changeId) {
				this.db.exec("UPDATE changes SET race_won = 1 WHERE id = ?", c.id);
				this.recordDecision({ changeId: c.id, outcome: "win", confidence: 1, probabilities: { [c.id]: 1 }, rationale: "Picked by a human.", decidedBy: `human:${by}` });
				if (c.status !== "landed") this.setStatus(c.id, "submitted");
			} else if (c.status !== "landed") {
				this.setStatus(c.id, "archived");
				this.releaseIntent(c.id);
			}
		}
		await this.pump();
	}

	// A human resolves an escalated change (or picks a race winner).
	async humanDecision(changeId: string, outcome: "land" | "bounce", by: string, note = "") {
		const change = this.change(changeId);
		if (!change || change.status !== "escalated") throw new Error(`change ${changeId} is not escalated`);
		this.recordDecision({ changeId, outcome, confidence: 1, probabilities: { [outcome]: 1 }, rationale: note || `Decided by ${by}`, decidedBy: `human:${by}` });
		if (outcome === "bounce") {
			if (note && !note.startsWith("A reviewer left")) this.addLesson(note, "send-back", changeId);
			this.setStatus(changeId, "bounced");
			if (this.isBuiltin(change.agentId)) await agentOf(this.ctx.exports, change.agentId).onBounced(note || "A reviewer sent this back.");
		} else {
			// Back in the queue with the approval recorded; the next batch lands it without asking Clef.
			this.setStatus(changeId, "submitted");
			await this.pump();
		}
	}

	humanApproved(changeId: string): boolean {
		const row = this.db.exec("SELECT decided_by, outcome FROM decisions WHERE change_id = ? ORDER BY created_at DESC LIMIT 1", changeId).toArray()[0];
		return !!row && String(row.decided_by).startsWith("human:") && row.outcome === "land";
	}

	// ── Trunk events ─────────────────────────────────────────────────────────

	// Every push to trunk (from Hive's landing or from a human with plain git) refreshes the
	// semantic index so intent overlap checks see the current code.
	async onTrunkPush(after: string, commits: { id: string; trailers: Record<string, string> }[]) {
		this.setTrunkHead(after);
		this.clearTrunkRed(); // a fix may have been pushed; the next batch re-checks
		const external = commits.filter((c) => !c.trailers["Hive-Change-Id"]);
		if (external.length > 0) this.emit({ type: "trunk", commit: after, changeId: null });
		await this.schedule(0, "reindex", { commit: after });
	}

	async reindex(payload: { commit: string }) {
		// Indexing runs natively (tree-sitter in hive-merge) in a dedicated merge box container.
		const graph = await mergeBoxOf(this.ctx.exports, `${this.repo}:index`).index({ repo: this.repo, commit: payload.commit });
		this.ctx.storage.transactionSync(() => {
			this.db.exec("DELETE FROM symbols");
			this.db.exec("DELETE FROM refs");
			for (const s of graph.symbols) this.db.exec("INSERT OR IGNORE INTO symbols VALUES (?, ?, ?)", s.path, s.name, s.kind);
			for (const r of graph.refs) this.db.exec("INSERT OR IGNORE INTO refs VALUES (?, ?, ?, ?)", r.from.path, r.from.name, r.to.path, r.to.name);
			this.db.exec("INSERT OR REPLACE INTO meta VALUES ('indexed_commit', ?)", payload.commit);
		});
	}

	indexStatus() {
		const commit = this.db.exec("SELECT value FROM meta WHERE key = 'indexed_commit'").toArray()[0];
		return {
			commit: commit ? String(commit.value) : null,
			symbols: Number(this.db.exec("SELECT COUNT(*) AS n FROM symbols").one().n),
			refs: Number(this.db.exec("SELECT COUNT(*) AS n FROM refs").one().n),
			files: this.db.exec("SELECT path, COUNT(*) AS n FROM symbols GROUP BY path ORDER BY path").toArray().map((r) => ({ path: String(r.path), symbols: Number(r.n) })),
		};
	}

	symbolsIn(path: string): { name: string; kind: string }[] {
		return this.db.exec("SELECT name, kind FROM symbols WHERE path = ? ORDER BY name", path).toArray().map((r) => ({ name: String(r.name), kind: String(r.kind) }));
	}

	// ── Read models ──────────────────────────────────────────────────────────

	changeDetail(changeId: string) {
		const change = this.change(changeId);
		if (!change) return null;
		const all = <T>(sql: string, map: (r: Record<string, SqlStorageValue>) => T) => this.db.exec(sql, changeId).toArray().map(map);
		return {
			change,
			goal: this.goal(change.goalId),
			issue: this.goalIssue(change.goalId),
			comments: this.comments(changeId),
			messages: this.messagesFor(changeId),
			intent: this.intentFor(changeId),
			evidence: all("SELECT * FROM evidence WHERE change_id = ? ORDER BY created_at", toEvidence),
			evaluations: all("SELECT * FROM evaluations WHERE change_id = ? ORDER BY created_at", toEvaluation),
			decisions: all("SELECT * FROM decisions WHERE change_id = ? ORDER BY created_at", toDecision),
		};
	}

	// Bounded: the active changes (up to 500) plus recent history, with exact counts per status.
	snapshot() {
		const active = this.db
			.exec("SELECT * FROM changes WHERE status NOT IN ('landed','archived') ORDER BY updated_at DESC LIMIT 500")
			.toArray();
		const recent = this.db.exec("SELECT * FROM changes WHERE status IN ('landed','archived') ORDER BY updated_at DESC LIMIT 100").toArray();
		return {
			repo: this.repo,
			counts: Object.fromEntries(this.db.exec("SELECT status, COUNT(*) AS n FROM changes GROUP BY status").toArray().map((r) => [String(r.status), Number(r.n)])),
			goals: this.db.exec("SELECT * FROM goals ORDER BY created_at DESC LIMIT 300").toArray().map((r) => toGoal(r, this.repo)).reverse(),
			changes: [...active, ...recent].map((r) => toChange(r, this.repo)).sort((a, b) => a.createdAt - b.createdAt),
			intents: this.intents.live(500),
			queue: this.queueOrder(),
			decisions: this.db.exec("SELECT * FROM decisions ORDER BY created_at DESC LIMIT 50").toArray().map(toDecision),
			agents: this.db.exec("SELECT * FROM agents").toArray().map((r) => ({ id: String(r.id), kind: String(r.kind), model: String(r.model), trust: Number(r.trust) })),
			trunkChecks: this.trunkChecks(),
			// Planned sub-goals' dependencies: [goal, the goal it waits for].
			// Pull requests opened on GitHub for goals.
			goalPrs: Object.fromEntries(this.db.exec("SELECT goal_id, number, url, state FROM goal_prs WHERE url IS NOT NULL").toArray().map((r) => [String(r.goal_id), { number: Number(r.number), url: String(r.url), state: String(r.state) }])),
			// Goals made from issues: goal id → owner/repo#n and its URL.
			goalIssues: Object.fromEntries(this.db.exec("SELECT goal_id, ref, url FROM goal_issues").toArray().map((r) => [String(r.goal_id), { ref: String(r.ref), url: String(r.url) }])),
			goalDeps: this.db.exec("SELECT goal_id, depends_on FROM goal_deps LIMIT 2000").toArray().map((r) => [String(r.goal_id), String(r.depends_on)] as [string, string]),
		};
	}
}

type Row = Record<string, SqlStorageValue>;
const json = <T>(v: SqlStorageValue): T => JSON.parse(String(v));

function toGoal(r: Row, repo: string): Goal {
	return {
		id: String(r.id),
		repo,
		title: String(r.title),
		description: String(r.description),
		status: r.status as Goal["status"],
		parentId: r.parent_id === null ? null : String(r.parent_id),
		createdAt: Number(r.created_at),
	};
}

function toChange(r: Row, repo: string): Change {
	return {
		id: String(r.id),
		goalId: String(r.goal_id),
		repo,
		fork: String(r.fork),
		agentId: String(r.agent_id),
		model: String(r.model),
		status: r.status as ChangeStatus,
		genesis: String(r.genesis),
		head: r.head === null ? null : String(r.head),
		race: r.race_group === null ? null : { group: String(r.race_group), index: Number(r.race_index), won: r.race_won === 1 },
		attempts: Number(r.attempts),
		createdAt: Number(r.created_at),
		updatedAt: Number(r.updated_at),
	};
}


function toEvidence(r: Row): Evidence {
	return {
		id: String(r.id),
		changeId: String(r.change_id),
		kind: r.kind as Evidence["kind"],
		command: String(r.command),
		ok: r.ok === 1,
		output: String(r.output),
		commit: String(r.commit_hash),
		createdAt: Number(r.created_at),
	};
}

function toEvaluation(r: Row): Evaluation {
	return {
		id: String(r.id),
		changeId: String(r.change_id),
		model: String(r.model),
		score: Number(r.score),
		summary: String(r.summary),
		concerns: json(r.concerns),
		createdAt: Number(r.created_at),
	};
}

function toDecision(r: Row): Decision {
	return {
		id: String(r.id),
		changeId: String(r.change_id),
		outcome: r.outcome as Decision["outcome"],
		confidence: Number(r.confidence),
		probabilities: json(r.probabilities),
		rationale: String(r.rationale),
		decidedBy: String(r.decided_by),
		createdAt: Number(r.created_at),
	};
}
