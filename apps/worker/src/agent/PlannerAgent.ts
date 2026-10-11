import { Agent } from "agents";
import { createAI, type WorkersAIModelId } from "agents/models/ai-sdk";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { coordinatorOf, gateOf } from "../bindings.ts";
import type { Goal } from "../domain/types.ts";
import { PROBE_FILES, planEvidence } from "../evidence/plan.ts";
import { describePlan } from "../evidence/run.ts";
import { repoHost } from "../repo/index.ts";

// The planner turns a big goal ("fix the security issues", "port this to Rust") into sub-goals
// that each land on their own, with dependencies, so Hive can run many agents on them at once.
// Planning is read-only, so it needs no container: it reads trunk through the Artifacts binding
// and the coordinator's code graph.

interface PlannerState {
	repo: string;
	goalId: string;
	model: string;
	phase: "idle" | "planning" | "done" | "failed";
	steps: number;
	error: string | null;
}

const MAX_STEPS = 45;
const clip = (s: string, max = 12000) => (s.length > max ? `${s.slice(0, max)}\n…[${s.length - max} more chars]` : s);

export class PlannerAgent extends Agent<Env, PlannerState> {
	initialState: PlannerState = { repo: "", goalId: "", model: "", phase: "idle", steps: 0, error: null };

	async start(input: { repo: string; goalId: string; model: string }) {
		this.setState({ ...this.initialState, ...input, phase: "planning" });
		await this.schedule(0, "work");
	}

	status(): PlannerState {
		return this.state;
	}

	async work() {
		this.ctx.waitUntil(
			this.keepAliveWhile(() => this.run()).catch((err) => {
				const reason = String((err as Error)?.message ?? err);
				this.setState({ ...this.state, phase: "failed", error: reason });
				return coordinatorOf(this.ctx.exports, this.state.repo).planFailed(this.state.goalId, reason);
			}),
		);
	}

	private async run() {
		const { repo, goalId, model } = this.state;
		const coordinator = coordinatorOf(this.ctx.exports, repo);
		const host = repoHost(this.env);
		const { goal, index } = await coordinator.planningContext(goalId);
		const files = await host.listFiles(repo, "main");
		const read = (path: string) => host.readFile(repo, "main", path);

		// What the merge queue will check, so the plan only proposes steps that can pass it.
		const probes: Record<string, string> = {};
		for (const f of PROBE_FILES.filter((p) => files.includes(p))) probes[f] = (await read(f)) ?? "";
		const checks = describePlan(planEvidence(probes));
		const notes = (await read("AGENTS.md")) ?? (await read("README.md")) ?? "";

		let proposed = false;
		const tools = {
			list_files: tool({
				description: "List files on trunk, optionally under a directory.",
				inputSchema: z.object({ dir: z.string().optional() }),
				execute: async ({ dir }) => {
					const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
					const hits = files.filter((f) => f.startsWith(prefix));
					return clip(hits.slice(0, 2000).join("\n") + (hits.length > 2000 ? `\n…and ${hits.length - 2000} more` : ""));
				},
			}),
			read_file: tool({
				description: "Read a file on trunk with line numbers. Use startLine/endLine for large files.",
				inputSchema: z.object({ path: z.string(), startLine: z.number().int().optional(), endLine: z.number().int().optional() }),
				execute: async ({ path, startLine, endLine }) => {
					const text = await read(path);
					if (text === null) return `No file ${path}.`;
					const lines = text.split("\n");
					const from = Math.max(1, startLine ?? 1);
					const to = Math.min(lines.length, endLine ?? from + 399);
					return clip(lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join("\n") + (to < lines.length ? `\n…(${lines.length} lines in all)` : ""));
				},
			}),
			search: tool({
				description: "Search trunk's files for a regular expression (up to 300 files, 100 matches). Narrow with a path prefix.",
				inputSchema: z.object({ pattern: z.string(), under: z.string().optional() }),
				execute: async ({ pattern, under }) => {
					let re: RegExp;
					try {
						re = new RegExp(pattern);
					} catch (e) {
						return `Bad pattern: ${(e as Error).message}`;
					}
					const candidates = files.filter((f) => (!under || f.startsWith(under)) && !/\.(png|jpe?g|gif|ico|woff2?|lock|pdf|zip|gz)$/i.test(f)).slice(0, 300);
					const out: string[] = [];
					for (const f of candidates) {
						const text = await read(f);
						if (!text || text.length > 400_000) continue;
						text.split("\n").forEach((line, i) => {
							if (out.length < 100 && re.test(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 200)}`);
						});
						if (out.length >= 100) break;
					}
					return out.length ? out.join("\n") : "No matches.";
				},
			}),
			symbols: tool({
				description: "Symbols (functions, classes, methods) Hive's code graph found in a file; without a path, which files have the most.",
				inputSchema: z.object({ path: z.string().optional() }),
				execute: async ({ path }) => {
					if (!path) return clip(index.files.sort((a, b) => b.symbols - a.symbols).slice(0, 200).map((f) => `${f.path}: ${f.symbols}`).join("\n") || "The code graph is empty (not indexed yet).");
					const syms = await coordinator.symbolsIn(path);
					return syms.length ? syms.map((s) => `${s.kind} ${s.name}`).join("\n") : `No symbols indexed for ${path}.`;
				},
			}),
			references: tool({
				description: "What on trunk refers to a symbol (callers, users): who a change to it would affect.",
				inputSchema: z.object({ path: z.string(), name: z.string() }),
				execute: async ({ path, name }) => {
					const refs = await coordinator.referencesTo(path, name);
					return refs.length ? refs.map((r) => `${r.path}#${r.name}`).join("\n") : "Nothing indexed refers to it.";
				},
			}),
			propose_plan: tool({
				description: "Submit the plan. Each sub-goal becomes a goal an agent works on in its own fork; it starts once the sub-goals it depends on have landed.",
				inputSchema: z.object({
					summary: z.string().describe("The approach in two or three sentences"),
					subgoals: z
						.array(
							z.object({
								key: z.string().describe("Short id such as s1, used in dependsOn"),
								title: z.string(),
								description: z.string().describe("What to change and the acceptance criteria, including the test that proves it"),
								paths: z.array(z.string()).optional().describe("Files it will most likely touch"),
								dependsOn: z.array(z.string()).optional().describe("Keys of sub-goals that must land first"),
							}),
						)
						.min(1)
						.max(40),
				}),
				execute: async (plan) => {
					try {
						const { goals } = await coordinator.applyPlan(goalId, plan);
						proposed = true;
						return `Plan accepted: ${goals.length} sub-goals created. Agents start as their dependencies land.`;
					} catch (e) {
						return `Plan rejected: ${(e as Error).message}. Fix it and call propose_plan again.`;
					}
				},
			}),
		};

		const gate = gateOf(this.ctx.exports, model);
		const ai = createAI({ binding: this.env.AI, id: "default" });
		await generateText({
			model: ai(model as WorkersAIModelId),
			system: plannerPrompt(goal, files.length, checks, notes.slice(0, 6000)),
			messages: [{ role: "user", content: "Explore the repository as much as you need, then call propose_plan." }],
			tools,
			// Stop once a plan is accepted (a rejected one gets another try within the step budget).
			stopWhen: [() => proposed, isStepCount(MAX_STEPS)],
			prepareStep: async () => {
				const wait = await gate.acquire();
				if (wait > 0) await new Promise((r) => setTimeout(r, wait));
				return {};
			},
			timeout: { stepMs: 10 * 60_000, toolMs: 5 * 60_000 },
			onStepEnd: (step) => {
				this.setState({ ...this.state, steps: this.state.steps + 1 });
				const calls = step.toolCalls.map((c) => c.toolName).join(", ");
				if (calls) coordinator.log(this.name, `→ ${calls}`);
			},
		});
		if (!proposed) throw new Error(`no plan after ${this.state.steps} steps`);
		this.setState({ ...this.state, phase: "done" });
	}
}

function plannerPrompt(goal: Goal, fileCount: number, checks: string, notes: string): string {
	return `You plan work in Hive, a version-control system where many coding agents work on one repository at once.

The goal (${goal.id}): ${goal.title}
${goal.description}

The repository has ${fileCount} files on trunk. Explore it with list_files, read_file, search,
symbols and references, then call propose_plan once.

How Hive works, which decides what a good plan is:
- Each sub-goal goes to one agent, in its own fork, and lands on trunk by itself after these checks
  pass on trunk plus the change:
${checks.split("\n").map((l) => `    ${l}`).join("\n")}
  So every sub-goal must be one coherent change that leaves trunk building and its tests passing.
  Never plan a step that breaks trunk on the way to a later fix.
- Sub-goals with no dependency between them run at the same time. Make parallel sub-goals touch
  different files and symbols, or they'll collide. Use dependsOn only for real ordering.
- Size: what one agent can do and verify in one sitting, usually a few files. Prefer 4 to 15
  sub-goals; more only when the work is genuinely that broad.
- Each description says what to change and how to prove it: name the test to add or update.

For particular kinds of goal:
- Security: one sub-goal per issue or per class of issue in one area. Each adds a test that fails
  before the fix (e.g. the injection payload, the path traversal, the missing auth check).
  Dependency upgrades are their own sub-goals.
- Rewrites and ports (e.g. to another language): first add behaviour tests that pin down what the
  code does today, in a form both versions can run (command-line or HTTP level, golden files).
  Then port one module at a time behind those tests, keeping the build green at every step, and
  only at the end remove the old code. If the target language's toolchain needs new checks, the
  first sub-goal adds a hive.json listing them.
- Large refactors: introduce the new shape alongside the old, migrate callers in batches by area,
  then delete the old one.

Repository notes:
${notes || "(no AGENTS.md or README.md)"}`;
}
