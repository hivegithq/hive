import { agentOf, landing, mergeBoxOf, simOf } from "../bindings.ts";
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
import { authenticatedRemote, changeRepo, head, ledgerRepo, repoHost } from "../repo/index.ts";
import { detectOverlaps, type ReferenceGraph } from "./overlap.ts";
import { selectBatch } from "../landing/batch.ts";
import { INTENT_SCHEMA, IntentStore, toIntent, touched } from "./intents.ts";
import { ForkPool } from "./forks.ts";
import { SCHEMA } from "./schema.ts";
import { type LedgerFiles, writeLedger } from "../ledger/ledger.ts";

export interface IntentResult {
	intent: Intent;
	overlaps: Overlap[];
	advice: { severity: number; action: OverlapAction; probabilities: Record<string, number> } | null;
}

export interface LandingParams {
	repo: string;
	changeIds: string[]; // a batch for "land"; exactly one race candidate for "evaluate"
	mode: "land" | "evaluate"; // evaluate = race candidate: gather evidence + review, don't touch trunk
}

export interface RepoSettings {
	decider: "clef" | "evidence"; // evidence: deterministic checks decide, no model calls
	batchMax: number; // changes stacked and verified together per landing
}

const DEFAULT_SETTINGS: RepoSettings = { decider: "clef", batchMax: 16 };

const LANDING_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_LANDING_RESTARTS = 3;
type AgentKind = "builtin" | "mcp" | "cli" | "sim";
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

	private async startLanding(changeIds: string[], mode: LandingParams["mode"]) {
		// Workflow instance ids are global, so they carry the repo name.
		const id = `${this.repo}-${mode === "land" ? "batch" : changeIds[0]}-${now()}`;
		await landing(this.env).create({ id, params: { repo: this.repo, changeIds, mode } satisfies LandingParams });
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
					stalled = ["errored", "terminated", "unknown"].includes(status);
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
			if (retry.length === 0) continue;
			this.log("hive", `restarting stalled landing for ${retry.length} change(s)`);
			await this.startLanding(retry, mode);
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
		// Time from a change's creation (fork) and from its submission to its landing decision.
		const landed = this.db
			.exec(
				`SELECT c.created_at AS created, c.submitted_at AS submitted, d.created_at AS landed_at FROM changes c
				 JOIN decisions d ON d.change_id = c.id AND d.outcome = 'land'
				 WHERE c.status = 'landed' AND c.created_at >= ?`,
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
		this.db.exec("INSERT OR REPLACE INTO meta VALUES ('settings', ?)", JSON.stringify(next));
		return next;
	}

	// Waking an agent's Durable Object lets it recover an interrupted fiber (deploys, restarts).
	async wakeAgents() {
		await this.reviveStalledLandings();
		const rows = this.db
			.exec("SELECT c.agent_id FROM changes c JOIN agents a ON a.id = c.agent_id WHERE c.status IN ('drafting','bounced') AND a.kind = 'builtin'")
			.toArray();
		await Promise.all(rows.map((r) => agentOf(this.ctx.exports, String(r.agent_id)).ping().catch(() => null)));
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
	}

	goal(goalId: string): Goal | null {
		const row = this.db.exec("SELECT * FROM goals WHERE id = ?", goalId).toArray()[0];
		return row ? toGoal(row, this.repo) : null;
	}

	// ── Putting agents to work ───────────────────────────────────────────────

	// One agent, one fork, one change.
	async assign(goalId: string, model: string = this.env.CODER_MODEL): Promise<Change> {
		const agentId = id("a");
		const change = await this.startChange({ goalId, agentId, model });
		await agentOf(this.ctx.exports, agentId).start({ repo: this.repo, changeId: change.id });
		return change;
	}

	// Restart the agent on a change that is still in its hands (e.g. after a crash or a model outage).
	async restartAgent(changeId: string): Promise<Change> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!["drafting", "bounced"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}, not with its agent`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent; restart it yourself`);
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
		return change;
	}

	// ── Intents ──────────────────────────────────────────────────────────────

	async declareIntent(changeId: string, input: { summary: string; paths: string[]; symbols: SymbolRef[] }): Promise<IntentResult> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
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
			advice = await adviseOnOverlap(this.env.AI, { mine: intent.summary, overlaps }).catch((err) => {
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
	async pump() {
		const landing = this.db.exec("SELECT 1 FROM changes WHERE status = 'converging' AND landing_mode = 'land' LIMIT 1").toArray();
		if (landing.length > 0) return;
		const { batchMax } = this.settings();
		const batch = selectBatch(this.queued(batchMax * 4), batchMax);
		if (batch.length === 0) return;
		for (const id of batch) this.setStatus(id, "converging");
		this.recordMetric("batch_size", batch.length);
		await this.startLanding(batch, "land");
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

	async batchFinished() {
		await this.pump();
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
		this.setTrunkHead(tip);
		await this.schedule(0, "reindex", { commit: tip });
	}

	async bounced(changeId: string, reason: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">, opts: { pump?: boolean } = {}) {
		const change = this.change(changeId)!;
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
		if (opts.pump !== false) await this.pump();
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
				: await judgeRace(this.env.AI, `${goal.title}\n\n${goal.description}`, scored);

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
