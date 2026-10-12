import { coordinatorOf, gateOf } from "../bindings.ts";
import { Agent, type FiberContext, type FiberRecoveryContext } from "agents";
import { createAI, type WorkersAIModelId } from "agents/models/ai-sdk";
import { generateText, hasToolCall, isStepCount, type ModelMessage } from "ai";
import type { Change, Goal } from "../domain/types.ts";
import { containerRemote, repoHost } from "../repo/index.ts";
import { Box, sh } from "../sandbox/box.ts";
import { describePlan, gatherEvidence, readPlan, runSetup } from "../evidence/run.ts";
import { REGISTRY_HOSTS } from "../sandbox/registries.ts";
import { bouncePrompt, systemPrompt } from "./prompts.ts";
import { codingTools, REPO_DIR } from "./tools.ts";

type Phase = "idle" | "working" | "submitted" | "fixing" | "done" | "failed";

interface AgentState {
	repo: string;
	changeId: string;
	phase: Phase;
	inbox: string[];
	steps: number;
	lastError: string | null;
}

type WorkPayload = { kind: "start" } | { kind: "bounce"; reason: string };
type Checkpoint = { payload: WorkPayload; messages: ModelMessage[] };

const MAX_STEPS = 60;
const MAX_NUDGES = 3;
const MAX_RATE_LIMIT_RETRIES = 6;
// Rate limits and provider hiccups are worth waiting out; anything else is a real failure.
// ("response.text is not a function" is how a rate-limited provider response surfaced in practice.)
const isTransient = (err: unknown) =>
	/rate.?limit|429|too many requests|overloaded|timed? ?out|ECONNRESET|50[234]|response\.text is not a function/i.test(String((err as Error)?.message ?? err));
const NUDGE =
	"You ended your turn without calling submit. Keep going using the tools: finish the change, run the tests with `run`, and call submit when they pass. Reply only with tool calls.";

// A coding agent: one Durable Object per change, with its own container as a workspace.
// The model loop runs in a fiber and checkpoints after every step, so eviction is survivable.
export class CodingAgent extends Agent<Env, AgentState> {
	initialState: AgentState = { repo: "", changeId: "", phase: "idle", inbox: [], steps: 0, lastError: null };

	private box = new Box(this.ctx, (policy) => this.ctx.exports.Outbound({ props: policy }));

	private get coordinator() {
		return coordinatorOf(this.ctx.exports, this.state.repo);
	}

	// ── Lifecycle (RPC from the coordinator) ─────────────────────────────────

	async start(input: { repo: string; changeId: string }) {
		// A restart replaces whatever loop is running (it may be stuck on a dead connection).
		this.abort.abort(new Error("restarted"));
		this.running = false;
		this.setState({ ...this.initialState, repo: input.repo, changeId: input.changeId, phase: "working" });
		await this.schedule(0, "work", { kind: "start" } satisfies WorkPayload);
	}

	async onBounced(reason: string) {
		this.setState({ ...this.state, phase: "fixing" });
		await this.schedule(0, "work", { kind: "bounce", reason } satisfies WorkPayload);
	}

	async onLanded(_commit: string) {
		this.setState({ ...this.state, phase: "done" });
		await this.release();
	}

	// The change is finished (landed or archived): stop the loop and give the container back.
	async release() {
		this.abort.abort(new Error("released"));
		if (this.ctx.container?.running) await this.ctx.container.destroy().catch(() => {});
	}

	receiveMessage(from: string, text: string) {
		this.setState({ ...this.state, inbox: [...this.state.inbox, `${from}: ${text}`] });
	}

	// ── The work loop ────────────────────────────────────────────────────────

	// Scheduler callbacks must stay short: the agent's job queue waits on them. The model loop
	// runs for minutes, so it is detached into a fiber, which survives eviction on its own.
	async work(payload: WorkPayload) {
		this.detach(`work:${this.state.changeId}`, (fiber) => this.loop(payload, fiber, null));
	}

	async onFiberRecovered(ctx: FiberRecoveryContext) {
		const checkpoint = (ctx as { snapshot?: Checkpoint | null }).snapshot ?? null;
		if (!ctx.name.startsWith("work:") || !checkpoint) return;
		this.coordinator.log(this.name, "resuming after restart");
		this.detach(ctx.name, (fiber) => this.loop(checkpoint.payload, fiber, checkpoint.messages));
	}

	// One work loop per agent at a time; a second start while one runs is ignored,
	// unless start() explicitly aborted the old one.
	private running = false;
	private abort = new AbortController();

	private detach(name: string, fn: (fiber: FiberContext) => Promise<void>) {
		if (this.running) return;
		this.running = true;
		this.abort = new AbortController();
		this.ctx.waitUntil(
			this.runFiber(name, fn)
				.catch((err) => console.error(`${name} failed`, err))
				.finally(() => {
					this.running = false;
				}),
		);
	}

	// Called by the coordinator's heartbeat; activation alone triggers fiber recovery.
	ping(): Phase {
		return this.state.phase;
	}

	private async loop(payload: WorkPayload, fiber: FiberContext, resumed: ModelMessage[] | null) {
		const detail = await this.coordinator.changeDetail(this.state.changeId);
		if (!detail?.goal) throw new Error(`change ${this.state.changeId} not found`);
		const { change, goal } = detail;
		const started = Date.now();
		let budgetHit = false;

		try {
			await this.prepareWorkspace(change);
			const notes = await this.box.run(`cat AGENTS.md 2>/dev/null | head -200`, { cwd: REPO_DIR });

			let messages = resumed ?? this.loadConversation();
			if (!resumed) {
				messages =
					payload.kind === "start"
						? [{ role: "user", content: "Begin. Explore the repository, declare your intent, implement the goal, test it, and submit." }]
						: [...messages, { role: "user", content: bouncePrompt(payload.reason) }];
			}

			// Checkpoint before the first model call, so an interruption during setup still resumes.
			fiber.stash({ payload, messages } satisfies Checkpoint);
			const ai = createAI({ binding: this.env.AI, id: "default" });
			let submitted = false;
			const tools = codingTools({
				box: this.box,
				declareIntent: (input) => this.declareIntent(input),
				message: (to, text) => this.coordinator.message(this.name, to, text),
				drainInbox: () => {
					const inbox = this.state.inbox;
					this.setState({ ...this.state, inbox: [] });
					return inbox;
				},
				syncTrunk: () => this.syncTrunk(change),
				runChecks: () => this.runChecks(),
				submit: async (message) => {
					const result = await this.commitAndSubmit(change, goal, message);
					submitted = result.startsWith("submitted");
					return result;
				},
			});

			const gate = gateOf(this.ctx.exports, change.model);
			const plan = await readPlan(this.shell(), { security: (await this.coordinator.settings()).security });
			const system = systemPrompt(goal, change, notes.exitCode === 0 && notes.stdout.trim() ? notes.stdout : null, describePlan(plan));
			let steps = 0;
			// Models sometimes end a turn without a tool call (or leak template tokens). Nudge them
			// back to work a few times before giving up, within the overall step budget.
			for (let nudge = 0; !submitted && steps < MAX_STEPS && nudge <= MAX_NUDGES; nudge++) {
				if (nudge > 0) {
					messages = [...messages, { role: "user", content: NUDGE }];
					this.coordinator.log(this.name, "nudged to continue");
				}
				let base = messages;
				const generated: ModelMessage[] = [];
				const run = () =>
					generateText({
						model: ai(change.model as WorkersAIModelId),
						system,
						messages: base,
						tools,
						stopWhen: [hasToolCall("submit"), isStepCount(MAX_STEPS - steps)],
						// Every model call waits for its slot in the model's shared, adaptive rate gate.
						prepareStep: async () => {
							// Every step is checked against the goal's budget before it's paid for.
							if (await this.coordinator.overBudget(goal.id)) {
								budgetHit = true;
								throw new Error("budget reached");
							}
							const wait = await gate.acquire();
							if (wait > 0) await new Promise((r) => setTimeout(r, wait));
							return {};
						},
						abortSignal: AbortSignal.any([fiber.signal, this.abort.signal]),
						// A hung model call (network drop, host sleep) must not stall the agent forever.
						timeout: { stepMs: 13 * 60_000, toolMs: 10.5 * 60_000 },
						onStepEnd: (step) => {
							steps++;
							this.ctx.waitUntil(
								this.coordinator
									.recordUsage({
										model: change.model,
										purpose: "agent",
										changeId: change.id,
										goalId: goal.id,
										agentId: this.name,
										inputTokens: step.usage.inputTokens ?? 0,
										outputTokens: step.usage.outputTokens ?? 0,
									})
									.catch(() => {}),
							);
							this.ctx.waitUntil(gate.report(false).catch(() => 0));
							// v7: each step's response.messages holds only that step's messages.
							generated.push(...step.response.messages);
							fiber.stash({ payload, messages: [...base, ...generated] } satisfies Checkpoint);
							this.setState({ ...this.state, steps: this.state.steps + 1 });
							const calls = step.toolCalls.map((c) => c.toolName).join(", ");
							const said = step.text.replace(/<\|[^|]*\|>/g, "").trim();
							if (calls) this.coordinator.log(this.name, `→ ${calls}`);
							else if (said) this.coordinator.log(this.name, said.slice(0, 300));
						},
					});
				// Many agents share one model's per-minute quota. On a rate limit, back off and resume
				// from the steps already completed rather than failing the whole run.
				for (let attempt = 0; ; attempt++) {
					try {
						await this.keepAliveWhile(run);
						break;
					} catch (err) {
						if (budgetHit || !isTransient(err) || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
						if (/rate.?limit|429|too many/i.test(String((err as Error)?.message ?? err))) await gate.report(true);
						const seconds = Math.round(Math.min(120, 10 * 2 ** attempt) * (0.75 + Math.random() / 2));
						this.coordinator.log(this.name, `${change.model} unavailable (${String((err as Error)?.message ?? err).slice(0, 80)}); retrying in ${seconds}s`);
						await new Promise((r) => setTimeout(r, seconds * 1000));
						base = [...base, ...generated.splice(0)];
					}
				}
				messages = [...base, ...generated];
				this.saveConversation(messages);
			}
			this.setState({ ...this.state, phase: submitted ? "submitted" : "failed", lastError: submitted ? null : "stopped without submitting" });
			if (!submitted) this.coordinator.log(this.name, `stopped without submitting after ${steps} steps`);
		} catch (err) {
			if (budgetHit) {
				this.setState({ ...this.state, phase: "failed", lastError: "budget reached" });
				await this.coordinator.budgetStopped(change.id);
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.setState({ ...this.state, phase: "failed", lastError: message });
			this.coordinator.log(this.name, `failed: ${message}`);
			throw err;
		} finally {
			// Container time for this run (the box is standard-1).
			const seconds = (Date.now() - started) / 1000;
			this.ctx.waitUntil(this.coordinator.recordUsage({ model: "container", purpose: "agent-box", changeId: change.id, goalId: goal.id, agentId: this.name, seconds, instance: "standard-1" }).catch(() => {}));
		}
	}

	// ── Workspace ────────────────────────────────────────────────────────────

	private async prepareWorkspace(change: Change) {
		const host = repoHost(this.env);
		const fork = await host.get(change.fork);
		const trunk = await host.get(change.repo);
		if (!fork || !trunk) throw new Error("fork or trunk repo missing");
		// The container gets write access to its own fork, read access to trunk, and package registries.
		await this.box.ensure({
			repos: [
				{ name: change.fork, scope: "write" },
				{ name: change.repo, scope: "read" },
			],
			hosts: REGISTRY_HOSTS,
		});
		const forkRemote = containerRemote(this.env, fork.remote);
		const trunkRemote = containerRemote(this.env, trunk.remote);
		const r = await this.box.run(
			`set -e
			if [ ! -d ${REPO_DIR}/.git ]; then git clone -q ${sh(forkRemote)} ${REPO_DIR}; fi
			cd ${REPO_DIR}
			git remote set-url origin ${sh(forkRemote)}
			git remote get-url trunk >/dev/null 2>&1 && git remote set-url trunk ${sh(trunkRemote)} || git remote add trunk ${sh(trunkRemote)}
			git config user.name ${sh(`hive agent ${this.name}`)}
			git config user.email ${sh(`${this.name}@agents.hive`)}
			# Dependencies and build output never belong in a commit, whatever the repo's .gitignore says.
			grep -qx 'target/' .git/info/exclude 2>/dev/null || printf 'node_modules/\\ntarget/\\n__pycache__/\\n.pytest_cache/\\n*.pyc\\n.venv/\\n' >> .git/info/exclude`,
		);
		if (r.exitCode !== 0) throw new Error(`workspace setup failed: ${r.stderr || r.stdout}`);
		// Install dependencies the way the merge box will; failures surface again in run_checks.
		await runSetup(this.shell(), await readPlan(this.shell()));
	}

	private shell() {
		return {
			exec: (command: string, timeoutMs?: number) => this.box.run(command, { cwd: REPO_DIR, timeoutMs }),
			write: (path: string, content: string) => this.box.files().writeFile(path, content),
		};
	}

	// The checks the convergence queue will run, in this workspace. Security findings are compared
	// with where this fork branched from trunk.
	private async runChecks(): Promise<string> {
		const { security } = await this.coordinator.settings();
		await this.box.run("git fetch -q trunk main 2>/dev/null; true", { cwd: REPO_DIR });
		const base = (await this.box.run("git merge-base HEAD trunk/main 2>/dev/null || git rev-parse HEAD", { cwd: REPO_DIR })).stdout.trim();
		const { plan, runs } = await gatherEvidence(this.shell(), { security, baseRef: base });
		if (plan.source === "none" && runs.length === 0) return describePlan(plan);
		const lines = runs.map((r) => (r.ok ? `PASS ${r.kind}: ${r.command}` : `FAIL ${r.kind}: ${r.command}\n${r.output.slice(-3000)}`));
		const failed = runs.filter((r) => !r.ok).length;
		return `${failed ? `${failed} of ${runs.length} checks failed.` : `All ${runs.length} checks passed.`}\n\n${lines.join("\n\n")}`;
	}

	private async declareIntent(input: { summary: string; paths: string[]; symbols: { path: string; name: string }[] }) {
		const { overlaps, advice } = await this.coordinator.declareIntent(this.state.changeId, input);
		if (overlaps.length === 0) return "Intent recorded. No other agent is touching this code. Proceed.";
		const lines = overlaps.map(
			(o) => `- ${o.level} overlap with agent ${o.otherAgentId} ("${o.otherSummary}"): ${o.detail.join("; ")}`,
		);
		const rec = advice
			? `Hive advises: ${advice.action.toUpperCase()} (severity ${advice.severity.toFixed(2)}).`
			: "Use your judgment: narrow your scope, or message the other agent.";
		return `Intent recorded, with overlaps:\n${lines.join("\n")}\n${rec}`;
	}

	private async syncTrunk(change: Change): Promise<string> {
		const r = await this.box.run(
			`git fetch -q trunk main && (git rebase trunk/main 2>&1 && echo REBASED || (echo CONFLICTS; git diff --name-only --diff-filter=U))`,
			{ cwd: REPO_DIR },
		);
		if (r.stdout.includes("REBASED")) return "Rebased onto latest trunk cleanly.";
		return `Rebase stopped on conflicts in:\n${r.stdout.split("CONFLICTS").at(-1)?.trim()}\nResolve the conflict markers in those files, then run: git add -A && git rebase --continue (via run). Change: ${change.id}`;
	}

	private async commitAndSubmit(change: Change, goal: Goal, message: string): Promise<string> {
		const detail = await this.coordinator.changeDetail(change.id);
		const trailers = [
			`Hive-Change-Id: ${change.id}`,
			`Hive-Goal: ${goal.id}`,
			detail?.intent ? `Hive-Intent: ${detail.intent.id}` : null,
			`Hive-Agent: ${this.name}`,
			`Hive-Model: ${change.model}`,
		].filter(Boolean);
		const full = `${message.trim()}\n\n${trailers.join("\n")}\n`;
		await this.box.files().writeFile("/tmp/hive-commit-msg", full);
		const r = await this.box.run(
			`set -e
			git add -A
			if git diff --cached --quiet; then echo NOCHANGES; exit 0; fi
			git commit -q -F /tmp/hive-commit-msg
			git push -q --force origin HEAD:main`,
			{ cwd: REPO_DIR },
		);
		if (r.stdout.includes("NOCHANGES")) {
			const ahead = await this.box.run(`git rev-list --count trunk/main..HEAD 2>/dev/null || echo 0`, { cwd: REPO_DIR });
			if (ahead.stdout.trim() === "0") return "Nothing to submit: no changes compared to trunk.";
			await this.box.run(`git push -q --force origin HEAD:main`, { cwd: REPO_DIR });
		} else if (r.exitCode !== 0) {
			return `Commit/push failed: ${r.stderr || r.stdout}`;
		}
		// Keep the diff for the dashboard; best effort, it doesn't block the submit.
		const d = await this.box.run(`base=$(git merge-base trunk/main HEAD) && echo "$base" && git rev-parse HEAD && git diff "$base" HEAD | head -c 400000`, { cwd: REPO_DIR });
		if (d.exitCode === 0) {
			const [base, headCommit, ...rest] = d.stdout.split("\n");
			if (base && headCommit) await this.coordinator.recordDiff(change.id, { source: "agent", base, head: headCommit, diff: rest.join("\n") }).catch(() => {});
		}
		try {
			await this.coordinator.submit(change.id);
			return "submitted: your change is in the convergence queue. You will be told if it bounces.";
		} catch (err) {
			const current = await this.coordinator.changeDetail(change.id);
			// Already queued from an earlier call: that's success, not a failure to retry.
			if (current && ["submitted", "converging", "evaluated", "landed"].includes(current.change.status)) {
				return `submitted: the change is already ${current.change.status}. Wait for the decision.`;
			}
			return `Submit rejected: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	// ── Conversation persistence (feeds the ledger and bounce follow-ups) ────

	private loadConversation(): ModelMessage[] {
		this.sql`CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY CHECK (id = 1), messages TEXT NOT NULL)`;
		const [row] = this.sql<{ messages: string }>`SELECT messages FROM conversation WHERE id = 1`;
		return row ? JSON.parse(row.messages) : [];
	}

	private saveConversation(messages: ModelMessage[]) {
		this.sql`CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY CHECK (id = 1), messages TEXT NOT NULL)`;
		this.sql`INSERT OR REPLACE INTO conversation (id, messages) VALUES (1, ${JSON.stringify(messages)})`;
	}

	// Returned as JSON text: the ModelMessage type is too deep to cross the RPC type boundary.
	transcript(): string {
		return JSON.stringify(this.loadConversation());
	}
}
