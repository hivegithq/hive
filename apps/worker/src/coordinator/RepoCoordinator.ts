import { agentOf, landing, mergeBoxOf } from "../bindings.ts";
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
import { detectOverlaps, type ReferenceGraph, touchedPaths } from "./overlap.ts";
import { orderQueue } from "./queue.ts";
import { SCHEMA } from "./schema.ts";
import { type LedgerFiles, writeLedger } from "../ledger/ledger.ts";

export interface IntentResult {
	intent: Intent;
	overlaps: Overlap[];
	advice: { severity: number; action: OverlapAction; probabilities: Record<string, number> } | null;
}

export interface LandingParams {
	repo: string;
	changeId: string;
	mode: "land" | "evaluate"; // evaluate = race candidate: gather evidence + review, don't touch trunk
}

const LANDING_TIMEOUT_MS = 20 * 60 * 1000;
const id = (prefix: string) => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
const now = () => Date.now();

// One coordinator per trunk repo. Owns intents, the convergence queue, the ledger,
// and is the only thing that lets a change reach trunk (one converging change at a time).
export class RepoCoordinator extends Agent<Env> {
	private get repo() {
		return this.name;
	}
	private get db() {
		return this.ctx.storage.sql;
	}

	async onStart() {
		for (const stmt of SCHEMA) this.db.exec(stmt);
		for (const column of ["landing_instance TEXT", "landing_mode TEXT", "landing_started INTEGER"]) {
			try {
				this.db.exec(`ALTER TABLE changes ADD COLUMN ${column}`);
			} catch {
				// already present
			}
		}
		await this.scheduleEvery(90, "wakeAgents");
	}

	private async startLanding(changeId: string, mode: LandingParams["mode"]) {
		const id = `${changeId}-${mode}-${now()}`;
		await landing(this.env).create({ id, params: { repo: this.repo, changeId, mode } satisfies LandingParams });
		this.db.exec("UPDATE changes SET landing_instance = ?, landing_mode = ?, landing_started = ? WHERE id = ?", id, mode, now(), changeId);
	}

	// Landings are Workflows and normally survive restarts. If one errored, was terminated, or
	// has been running far longer than any landing should, start it again.
	private async reviveStalledLandings() {
		const rows = this.db.exec("SELECT id, landing_instance, landing_mode, landing_started FROM changes WHERE status = 'converging'").toArray();
		for (const r of rows) {
			const changeId = String(r.id);
			const mode = (r.landing_mode === "evaluate" ? "evaluate" : "land") as LandingParams["mode"];
			let stalled = r.landing_instance === null || now() - Number(r.landing_started ?? 0) > LANDING_TIMEOUT_MS;
			if (!stalled) {
				try {
					const { status } = await landing(this.env).get(String(r.landing_instance)).then((i) => i.status());
					stalled = ["errored", "terminated", "unknown"].includes(status);
				} catch {
					stalled = true;
				}
			}
			if (!stalled) continue;
			if (r.landing_instance) await landing(this.env).get(String(r.landing_instance)).then((i) => i.terminate()).catch(() => {});
			this.log("hive", `restarting stalled landing for ${changeId}`);
			await this.startLanding(changeId, mode);
		}
	}

	// Waking an agent's Durable Object lets it recover an interrupted fiber (deploys, restarts).
	async wakeAgents() {
		await this.reviveStalledLandings();
		const rows = this.db
			.exec("SELECT c.agent_id FROM changes c JOIN agents a ON a.id = c.agent_id WHERE c.status IN ('drafting','bounced') AND a.kind = 'builtin'")
			.toArray();
		await Promise.all(rows.map((r) => agentOf(this.env, String(r.agent_id)).ping().catch(() => null)));
	}

	onConnect(connection: Connection) {
		connection.send(JSON.stringify({ type: "snapshot", snapshot: this.snapshot() }));
	}

	private emit(event: HiveEvent) {
		this.broadcast(JSON.stringify(event));
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
		await agentOf(this.env, agentId).start({ repo: this.repo, changeId: change.id });
		return change;
	}

	// Restart the agent on a change that is still in its hands (e.g. after a crash or a model outage).
	async restartAgent(changeId: string): Promise<Change> {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (!["drafting", "bounced"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}, not with its agent`);
		if (!this.isBuiltin(change.agentId)) throw new Error(`${change.agentId} is an external agent; restart it yourself`);
		await agentOf(this.env, change.agentId).start({ repo: this.repo, changeId });
		this.log(change.agentId, "restarted");
		return change;
	}

	// Give up on a change: archive it and release its intent so it stops showing as an overlap.
	abandon(changeId: string, by: string): Change {
		const change = this.change(changeId);
		if (!change) throw new Error(`unknown change ${changeId}`);
		if (["landed", "archived", "converging"].includes(change.status)) throw new Error(`change ${changeId} is ${change.status}`);
		this.releaseIntent(changeId);
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
		await Promise.all(changes.map((c) => agentOf(this.env, c.agentId).start({ repo: this.repo, changeId: c.id })));
		return { group, changes };
	}

	// ── Changes ──────────────────────────────────────────────────────────────

	// Fork trunk into a fresh repo for this change. The fork is the change's isolated workspace.
	async startChange(input: {
		goalId: string;
		agentId: string;
		model: string;
		race?: { group: string; index: number };
		kind?: "builtin" | "mcp" | "cli";
	}): Promise<Change> {
		const host = repoHost(this.env);
		const changeId = id("c");
		const genesis = (await head(host, this.repo)) ?? "";
		const fork = changeRepo(this.repo, changeId);
		await host.fork(this.repo, fork, `Hive change ${changeId}`);
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
		this.db.exec("UPDATE intents SET released_at = ? WHERE change_id = ? AND released_at IS NULL", now(), changeId);

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
		this.db.exec(
			"INSERT INTO intents VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
			intent.id,
			changeId,
			intent.agentId,
			intent.summary,
			JSON.stringify(intent.paths),
			JSON.stringify(intent.symbols),
			intent.createdAt,
		);

		// Race candidates deliberately overlap each other; only compare against other goals' work.
		const live = this.liveIntents().filter((i) => {
			const other = this.change(i.changeId);
			return !(change.race && other?.race?.group === change.race.group);
		});
		const overlaps = detectOverlaps(intent, live, this.referenceGraph());
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
			this.ctx.waitUntil(agentOf(this.env, o.otherAgentId).receiveMessage("hive", note).catch(() => {}));
		}
		return { intent, overlaps, advice };
	}

	releaseIntent(changeId: string) {
		const rows = this.db.exec("SELECT id FROM intents WHERE change_id = ? AND released_at IS NULL", changeId).toArray();
		this.db.exec("UPDATE intents SET released_at = ? WHERE change_id = ? AND released_at IS NULL", now(), changeId);
		for (const r of rows) this.emit({ type: "intent_released", intentId: String(r.id) });
	}

	liveIntents(): Intent[] {
		return this.db.exec("SELECT * FROM intents WHERE released_at IS NULL").toArray().map(toIntent);
	}

	private intentFor(changeId: string): Intent | null {
		const row = this.db
			.exec("SELECT * FROM intents WHERE change_id = ? ORDER BY created_at DESC LIMIT 1", changeId)
			.toArray()[0];
		return row ? toIntent(row) : null;
	}

	referenceGraph(): ReferenceGraph {
		return {
			dependentsOf: (s) =>
				this.db
					.exec("SELECT from_path, from_name FROM refs WHERE to_path = ? AND to_name = ?", s.path, s.name)
					.toArray()
					.map((r) => ({ path: String(r.from_path), name: String(r.from_name) })),
		};
	}

	// ── Messaging between agents ─────────────────────────────────────────────

	async message(from: string, to: string, text: string) {
		this.db.exec("INSERT INTO messages VALUES (?, ?, ?, ?, ?)", id("m"), from, to, text, now());
		this.emit({ type: "message", from, to, text });
		const target = this.db.exec("SELECT id FROM changes WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", to).toArray()[0];
		if (target && this.isBuiltin(to)) await agentOf(this.env, to).receiveMessage(from, text);
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

	// Start the next landing if nothing is converging. Only one change converges at a time,
	// which makes the coordinator the single writer to trunk.
	async pump() {
		const converging = this.db.exec("SELECT id FROM changes WHERE status = 'converging' AND (race_group IS NULL OR race_won = 1)").toArray();
		if (converging.length > 0) return;
		const pending = this.db
			.exec("SELECT id, submitted_at FROM changes WHERE status = 'submitted' AND (race_group IS NULL OR race_won = 1)")
			.toArray()
			.map((r) => {
				const intent = this.intentFor(String(r.id));
				return { changeId: String(r.id), submittedAt: Number(r.submitted_at), paths: intent ? touchedPaths(intent) : new Set<string>() };
			});
		const [next] = orderQueue(pending);
		if (!next) return;
		this.setStatus(next.changeId, "converging");
		await this.startLanding(next.changeId, "land");
	}

	queueOrder(): { changeId: string; position: number }[] {
		const pending = this.db
			.exec("SELECT id, submitted_at FROM changes WHERE status = 'submitted' AND (race_group IS NULL OR race_won = 1)")
			.toArray()
			.map((r) => {
				const intent = this.intentFor(String(r.id));
				return { changeId: String(r.id), submittedAt: Number(r.submitted_at), paths: intent ? touchedPaths(intent) : new Set<string>() };
			});
		return orderQueue(pending).map((p, position) => ({ changeId: p.changeId, position }));
	}

	// ── Race mode ────────────────────────────────────────────────────────────

	private async startRaceEvaluation(change: Change) {
		this.setStatus(change.id, "converging");
		await this.startLanding(change.id, "evaluate");
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
				? await agentOf(this.env, detail.change.agentId)
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

	private ensureAgent(agentId: string, model: string, kind: "builtin" | "mcp" | "cli" = "builtin") {
		this.db.exec("INSERT OR IGNORE INTO agents VALUES (?, ?, ?, ?)", agentId, kind, model, kind === "builtin" ? 0.8 : 0.6);
	}

	// Landing workflow pushed the rebased change to trunk.
	async landed(changeId: string, commit: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">) {
		const change = this.change(changeId)!;
		this.recordDecision({ ...d, changeId, outcome: "land" });
		this.setStatus(changeId, "landed", { head: commit });
		this.releaseIntent(changeId);
		// Trust is earned: each clean landing nudges the agent up.
		this.db.exec("UPDATE agents SET trust = MIN(1.0, trust + 0.02) WHERE id = ?", change.agentId);
		this.emit({ type: "trunk", commit, changeId });
		await this.schedule(0, "reindex", { commit });
		if (this.db.exec("SELECT COUNT(*) AS n FROM changes WHERE goal_id = ? AND status NOT IN ('landed','archived')", change.goalId).one().n === 0) {
			this.setGoalStatus(change.goalId, "achieved");
		}
		if (this.isBuiltin(change.agentId)) await agentOf(this.env, change.agentId).onLanded(commit).catch(() => {});
		await this.pump();
	}

	async bounced(changeId: string, reason: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">) {
		const change = this.change(changeId)!;
		this.recordDecision({ ...d, changeId, outcome: "bounce" });
		this.setStatus(changeId, "bounced");
		// External agents (MCP, CLI) read the reason from the change detail instead.
		if (this.isBuiltin(change.agentId)) {
			await agentOf(this.env, change.agentId).onBounced(reason).catch((err: unknown) => console.warn("bounce delivery failed", err));
		}
		await this.pump();
	}

	async escalated(changeId: string, d: Omit<Decision, "id" | "createdAt" | "changeId" | "outcome">) {
		this.recordDecision({ ...d, changeId, outcome: "escalate" });
		this.setStatus(changeId, "escalated");
		await this.pump();
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
			if (this.isBuiltin(change.agentId)) await agentOf(this.env, change.agentId).onBounced(note || "A reviewer sent this back.");
		} else {
			// Re-run landing with the human's approval recorded; the workflow skips Clef when approved.
			this.setStatus(changeId, "converging");
			await this.startLanding(changeId, "land");
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
		const external = commits.filter((c) => !c.trailers["Hive-Change-Id"]);
		if (external.length > 0) this.emit({ type: "trunk", commit: after, changeId: null });
		await this.schedule(0, "reindex", { commit: after });
	}

	async reindex(payload: { commit: string }) {
		// Indexing runs natively (tree-sitter in hive-merge) in a dedicated merge box container.
		const graph = await mergeBoxOf(this.env, `${this.repo}:index`).index({ repo: this.repo, commit: payload.commit });
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

	snapshot() {
		return {
			repo: this.repo,
			goals: this.db.exec("SELECT * FROM goals ORDER BY created_at").toArray().map((r) => toGoal(r, this.repo)),
			changes: this.db.exec("SELECT * FROM changes ORDER BY created_at").toArray().map((r) => toChange(r, this.repo)),
			intents: this.liveIntents(),
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

function toIntent(r: Row): Intent {
	return {
		id: String(r.id),
		changeId: String(r.change_id),
		agentId: String(r.agent_id),
		summary: String(r.summary),
		paths: json(r.paths),
		symbols: json(r.symbols),
		createdAt: Number(r.created_at),
		releasedAt: r.released_at === null ? null : Number(r.released_at),
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
