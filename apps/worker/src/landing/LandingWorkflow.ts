import { type WorkflowEvent, WorkflowEntrypoint, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import { createAI, type WorkersAIModelId } from "agents/models/ai-sdk";
import { generateText } from "ai";
import { coordinatorOf, gateOf, mergeBoxOf } from "../bindings.ts";
import type { LandingParams } from "../coordinator/RepoCoordinator.ts";
import { decideLanding, MAX_ATTEMPTS } from "../decide/policy.ts";
import type { Change, Goal, Intent } from "../domain/types.ts";
import { type AttemptFn, evidenceOk, findLandable } from "./batch.ts";
import type { EvidenceRun, PushResult, ReferentialConflict, StackEntry, StackResult } from "./MergeBox.ts";

const FETCH_CHUNK = 32;
// A fast, free-tier model, so a busy or slow primary reviewer still leaves a written review.
const FALLBACK_REVIEW_MODEL = "@cf/openai/gpt-oss-120b";
const RETRY = { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "15 minutes" } as const satisfies WorkflowStepConfig;

interface Item {
	change: Change;
	goal: Goal;
	intent: Intent | null;
}

export interface DecisionRecord {
	outcome: "land" | "bounce" | "escalate";
	confidence: number;
	probabilities: Record<string, number>;
	rationale: string;
	decidedBy: string;
	reason?: string; // what the agent is told on a bounce
}

const describeConflicts = (refs: ReferentialConflict[]) =>
	refs.map((r) =>
		r.direction === "trunk-uses-change"
			? `Trunk code ${r.affected} (changed since this work began) calls ${r.changed}, which this change modifies.`
			: `This change's ${r.changed} calls ${r.affected}, which trunk modified since this work began.`,
	);

// The convergence pipeline. "land" takes a batch of queued changes: stack them on trunk, verify the
// stack once (halving on failure), decide each change, and fast-forward trunk once. "evaluate" runs a
// single race candidate through the same checks without touching trunk.
export class LandingWorkflow extends WorkflowEntrypoint<Env, LandingParams> {
	async run(event: WorkflowEvent<LandingParams>, step: WorkflowStep) {
		const { repo, changeIds, mode, slot = 0 } = event.payload;
		const coordinator = coordinatorOf(this.ctx.exports, repo);
		// Landings share one merge box per repo (it holds the trunk checkout); race evaluations get their own.
		const box = mergeBoxOf(this.ctx.exports, mode === "land" ? (slot ? `${repo}#${slot}` : repo) : `${repo}:${changeIds[0]}`);

		const { settings, mirrors, items } = await step.do("load batch", async () => {
			const details = await Promise.all(changeIds.map((id) => coordinator.changeDetail(id)));
			const loaded: Item[] = details.flatMap((d) => (d?.goal ? [{ change: d.change, goal: d.goal, intent: d.intent }] : []));
			return { settings: await coordinator.settings(), mirrors: await coordinator.mirrors(), items: loaded };
		});
		const byId = new Map(items.map((i) => [i.change.id, i]));
		const entries = (ids: string[]): StackEntry[] => ids.map((id) => ({ changeId: id, fork: byId.get(id)!.change.fork }));
		const race = mode === "evaluate" ? items[0]?.change.race : null;

		await step.do("prepare merge box", RETRY, () => box.prepare({ repo, canPush: mode === "land", mirrors }));
		// Forks arrive in short steps: one dropped connection costs a chunk, not the whole batch.
		const forks = items.map((i) => i.change.fork);
		const unavailable: { fork: string; error: string }[] = [];
		for (let i = 0; i < forks.length; i += FETCH_CHUNK) {
			const chunk = forks.slice(i, i + FETCH_CHUNK);
			unavailable.push(...(await step.do(`fetch forks ${i}`, RETRY, () => box.fetchForks(chunk))).unavailable);
		}

		// A fork that's missing or has no main is the agent's to fix; a timeout or dropped connection
		// is ours, so those changes go back in the queue without costing the agent an attempt.
		const unreachable = new Map(unavailable.map((u) => [u.fork, u.error]));
		const agentsFault = (err: string) => /not found|couldn't find remote ref|does not appear to be a git repository|\b40[34]\b/i.test(err);
		const ready = items.filter((i) => !unreachable.has(i.change.fork)).map((i) => i.change.id);
		const transient = items.filter((i) => unreachable.has(i.change.fork) && !agentsFault(unreachable.get(i.change.fork)!)).map((i) => i.change.id);
		if (transient.length) await step.do("requeue forks that didn't fetch", () => coordinator.requeue(transient));
		if (unreachable.size > transient.length) {
			await step.do("bounce unreachable forks", async () => {
				for (const item of items.filter((i) => unreachable.has(i.change.fork) && !transient.includes(i.change.id))) {
					await this.reject(coordinator, item, {
						outcome: "bounce",
						confidence: 1,
						probabilities: { bounce: 1 },
						rationale: "Hive couldn't fetch the fork.",
						decidedBy: "hive:merge",
						reason: `Hive couldn't fetch your fork's main branch (${unreachable.get(item.change.fork)}). Push your work again and resubmit.`,
					});
				}
			});
		}

		// Fetching is done; now wait for the trunk lease. Only the holder stacks, verifies and pushes,
		// so a pipelined batch always builds on what the batch before it landed.
		if (mode === "land") {
			for (let i = 0; ; i++) {
				const held = await step.do(`acquire trunk lease ${i}`, () => coordinator.acquireLease(event.instanceId));
				if (held) break;
				await step.sleep(`wait for trunk ${i}`, "3 seconds");
			}
		}

		const applied = (s: StackResult) => s.entries.filter((e) => e.ok).map((e) => e.changeId);
		const attempt: AttemptFn = (label, ids, onto) =>
			step.do(`stack and verify: ${label}`, RETRY, async () => {
				// On top of the verified stack when the container still has it; else everything from trunk.
				const top = onto ? await box.stack(entries(ids), onto.stack.tip) : null;
				const stack: StackResult = top
					? { trunk: onto!.stack.trunk, tip: top.tip, entries: [...onto!.stack.entries.filter((e) => e.ok), ...top.entries] }
					: (await box.stack(entries([...(onto ? applied(onto.stack) : []), ...ids])))!;
				const evidence: EvidenceRun[] = await box.evidence({ security: settings.security });
				return { stack, evidence };
			});

		const outcome = await findLandable(attempt, ready);

		// Trunk itself fails verification: nobody in this batch is to blame. Put them all back,
		// tell people trunk is red, and let the queue back off until someone fixes it.
		if (outcome.trunkRed) {
			const red = outcome.trunkRed;
			await step.do("trunk is red", async () => {
				await coordinator.requeue(items.map((i) => i.change.id));
				await coordinator.markTrunkRed({ commit: red.commit, output: red.evidence.filter((e) => !e.ok).map((e) => e.output.slice(-1500)).join("\n\n") });
			});
			await step.do("finish batch", () => coordinator.batchFinished(event.instanceId));
			return { landed: 0, trunkRed: red.commit };
		}

		// Changes that can't land in this batch: conflicts and culprits go back to their agents
		// (or to a person after repeated attempts); untested ones rejoin the queue.
		await step.do("settle changes that can't land", async () => {
			const trunk = outcome.attempt?.stack.trunk ?? "";
			for (const c of outcome.conflicted) {
				const item = byId.get(c.changeId)!;
				const excerpt = c.conflicts.map((x) => `### ${x.path}\n${x.excerpt}`).join("\n\n");
				await coordinator.recordEvidence({ changeId: c.changeId, kind: "merge", command: "git cherry-pick (mergiraf)", ok: false, output: excerpt, commit: trunk });
				await this.reject(coordinator, item, {
					outcome: "bounce",
					confidence: 1,
					probabilities: { bounce: 1 },
					rationale: "Unresolvable merge conflict.",
					decidedBy: "hive:merge",
					reason: `Stacking onto trunk left conflicts that structural merge could not resolve:\n\n${excerpt}`,
				});
			}
			for (const id of outcome.empty) {
				await this.reject(coordinator, byId.get(id)!, {
					outcome: "bounce",
					confidence: 1,
					probabilities: { bounce: 1 },
					rationale: "The fork has no commits of its own.",
					decidedBy: "hive:merge",
					reason: "Nothing to land: your fork has no commits beyond trunk. Commit your work and submit again.",
				});
			}
			for (const { changeId, evidence } of outcome.culprits) {
				for (const run of evidence) await coordinator.recordEvidence({ changeId, ...run, commit: trunk });
				await this.reject(coordinator, byId.get(changeId)!, {
					outcome: "bounce",
					confidence: 1,
					probabilities: { bounce: 1 },
					rationale: "Tests or checks failed with this change on top of trunk.",
					decidedBy: "hive:evidence",
					reason: evidence
						.filter((e) => !e.ok)
						.map((e) => `\`${e.command}\` failed:\n${e.output.slice(-3000)}`)
						.join("\n\n"),
				});
			}
			if (outcome.requeue.length) await coordinator.requeue(outcome.requeue);
		});

		if (!outcome.attempt || outcome.land.length === 0) {
			// Nothing passed. Rejected race candidates went back to their agents to fix, like any change.
			await step.do("finish batch", () => coordinator.batchFinished(event.instanceId));
			return { landed: 0, rejected: changeIds.length - outcome.requeue.length, requeued: outcome.requeue.length };
		}

		const passing = outcome.attempt;
		const slices = new Map(passing.stack.entries.flatMap((e) => (e.ok ? [[e.changeId, e] as const] : [])));

		// Decide each change on its own slice of the stack, in parallel.
		const verdicts = await Promise.all(
			outcome.land.map((id) =>
				step.do(`decide ${id}`, RETRY, async (): Promise<DecisionRecord> => {
					const item = byId.get(id)!;
					const slice = slices.get(id)!;
					await coordinator.recordEvidence({
						changeId: id,
						kind: "merge",
						command: "git cherry-pick (mergiraf)",
						ok: true,
						output: `Stacked onto ${passing.stack.trunk.slice(0, 8)} → ${slice.tip.slice(0, 8)}\n${slice.files.join("\n")}`,
						commit: slice.tip,
					});
					for (const run of passing.evidence) await coordinator.recordEvidence({ changeId: id, ...run, commit: slice.tip });
					return this.decide(coordinator, box, item, slice, passing.evidence, settings.decider, mode);
				}),
			),
		);

		if (mode === "evaluate") {
			await step.do("hand to race judge", () => coordinator.evaluated(outcome.land[0]));
			if (race) {
				await step.do("push preview", async () => {
					const r = await box.pushPreview({ previewRepo: `${repo}.preview`, branch: `race/${race.group}/${race.index}` });
					return { ok: r.ok, reason: r.reason };
				});
			}
			return { evaluated: outcome.land[0] };
		}

		let approved = outcome.land.filter((_, i) => verdicts[i].outcome === "land");
		await step.do("settle rejected verdicts", async () => {
			for (const [i, id] of outcome.land.entries()) {
				if (verdicts[i].outcome !== "land") await this.reject(coordinator, byId.get(id)!, verdicts[i]);
			}
		});

		// If some changes were turned down, the approved ones must be verified without them.
		let final = passing;
		if (approved.length > 0 && approved.length < outcome.land.length) {
			final = await attempt(`approved ${approved.length}`, approved, null);
			const allApplied = final.stack.entries.every((e) => e.ok);
			if (!allApplied || !evidenceOk(final.evidence)) {
				const retry = approved;
				await step.do("requeue after restack failed", () => coordinator.requeue(retry));
				approved = [];
			}
		}

		if (approved.length > 0) {
			const pushed = await step.do("push to trunk", RETRY, async (): Promise<{ push: PushResult; tips: Record<string, string> }> => {
				const tipsOf = (s: StackResult) => Object.fromEntries(s.entries.flatMap((e) => (e.ok ? [[e.changeId, e.tip]] : [])));
				const first = await box.push(final.stack.tip);
				if (first.ok) return { push: first, tips: tipsOf(final.stack) };
				// Trunk moved (someone pushed directly) or the container restarted. Restack and re-verify once.
				const again = await box.stack(entries(approved));
				if (!again || !again.entries.every((e) => e.ok) || !evidenceOk(await box.evidence({ security: settings.security }))) {
					return { push: { ok: false, reason: "trunk moved and the batch no longer verifies" }, tips: {} };
				}
				return { push: await box.push(again.tip), tips: tipsOf(again) };
			});
			if (pushed.push.ok) {
				const landed = approved.map((id) => ({ changeId: id, commit: pushed.tips[id], decision: verdicts[outcome.land.indexOf(id)] }));
				const tip = pushed.push.commit;
				await step.do("mark landed", () => coordinator.landedBatch(landed, tip));
				// Start the next batch first: mirrors only affect new forks, so their refresh needn't block the queue.
				await step.do("finish batch", () => coordinator.batchFinished(event.instanceId));
				if (mirrors.length) await step.do("refresh fork mirrors", () => box.refreshMirrors());
				return { landed: approved.length, considered: changeIds.length };
			} else {
				const retry = approved;
				await step.do("requeue after failed push", () => coordinator.requeue(retry));
			}
		}

		await step.do("finish batch", () => coordinator.batchFinished(event.instanceId));
		return { landed: approved.length, considered: changeIds.length };
	}

	private async reject(coordinator: ReturnType<typeof coordinatorOf>, item: Item, d: DecisionRecord) {
		const decision = { confidence: d.confidence, probabilities: d.probabilities, rationale: d.rationale, decidedBy: d.decidedBy };
		// Don't bounce forever: after MAX_ATTEMPTS, a person takes a look.
		if (d.outcome === "escalate" || item.change.attempts >= MAX_ATTEMPTS) {
			const rationale = d.outcome === "escalate" ? d.rationale : `${d.rationale} (attempt ${item.change.attempts}; asking a person instead of looping.)`;
			await coordinator.escalated(item.change.id, { ...decision, rationale }, { pump: false });
		} else {
			await coordinator.bounced(item.change.id, d.reason ?? d.rationale, decision, { pump: false });
		}
	}

	private async decide(
		coordinator: ReturnType<typeof coordinatorOf>,
		box: ReturnType<typeof mergeBoxOf>,
		item: Item,
		slice: { prev: string; tip: string },
		evidence: EvidenceRun[],
		decider: "clef" | "evidence",
		mode: LandingParams["mode"],
	): Promise<DecisionRecord> {
		const { change, goal, intent } = item;
		const referential: ReferentialConflict[] = await box.referential(change.fork);
		const conflicts = describeConflicts(referential);
		// What this change adds on top of the stack below it: kept for the dashboard's diff view.
		const { diff, structuralDiff } = await box.diff(slice.prev, slice.tip);
		await coordinator.recordDiff(change.id, { source: "merge", base: slice.prev, head: slice.tip, diff });

		if (mode === "land" && (await coordinator.humanApproved(change.id))) {
			return { outcome: "land", confidence: 1, probabilities: { land: 1 }, rationale: "Approved by a human reviewer.", decidedBy: "human" };
		}

		// Evidence-only repositories: deterministic checks decide, no model calls.
		if (decider === "evidence") {
			await coordinator.recordEvaluation({ changeId: change.id, model: "hive:evidence", score: 1, summary: "Evidence-only repository: no model review.", concerns: conflicts });
			if (conflicts.length) {
				return { outcome: "escalate", confidence: 1, probabilities: { escalate: 1 }, rationale: `${conflicts.length} referential conflict(s) need a look.`, decidedBy: "hive:evidence" };
			}
			return { outcome: "land", confidence: 1, probabilities: { land: 1 }, rationale: "Evidence passed.", decidedBy: "hive:evidence" };
		}

		const notes = await this.review(goal.title, goal.description, intent?.summary ?? "", structuralDiff || diff, conflicts);
		const verdict = await decideLanding(
			this.env.AI,
			{
				goal: `${goal.title}\n${goal.description}`,
				intent: intent?.summary ?? "",
				diff: diff.slice(0, 40000),
				evidence: evidence.map((e) => ({ kind: e.kind, ok: e.ok, output: e.output.slice(-1500) })),
				conflicts,
			},
			await coordinator.trust(change.agentId),
			change.attempts,
		);
		await coordinator.recordEvaluation({
			changeId: change.id,
			model: `${this.env.REVIEW_MODEL} + clef-flash`,
			score: verdict.reviewScore,
			summary: notes.summary,
			concerns: [...notes.concerns, ...conflicts],
		});
		const reason = [
			verdict.rationale,
			...(conflicts.length ? ["Referential conflicts:", ...conflicts] : []),
			...(notes.concerns.length ? ["Reviewer concerns:", ...notes.concerns.map((c) => `- ${c}`)] : []),
		].join("\n\n");
		return {
			outcome: verdict.outcome,
			confidence: verdict.confidence,
			probabilities: verdict.probabilities,
			rationale: verdict.rationale,
			decidedBy: "clef-flash",
			reason,
		};
	}

	// A written review. Clef supplies the calibrated score; this supplies the words. Reviewers share
	// per-minute quotas with coding agents, so each call is bounded and falls back to a second model.
	private async review(title: string, description: string, intent: string, diff: string, conflicts: string[]): Promise<{ summary: string; concerns: string[] }> {
		const ai = createAI({ binding: this.env.AI, id: "default" });
		const prompt = `Goal: ${title}\n${description}\n\nDeclared intent: ${intent}\n\n${conflicts.length ? `Known conflicts:\n${conflicts.join("\n")}\n\n` : ""}Diff:\n${diff.slice(0, 50000)}`;
		const system =
			"You review code changes written by AI agents. Be specific and brief. Respond with JSON only: " +
			'{"summary": "<two sentences>", "concerns": ["<concrete issue>", ...]}. Empty concerns if none.';
		const errors: string[] = [];
		// The primary gets one bounded try; the fallback is fast and gets a retry.
		const attempts = [
			{ model: this.env.REVIEW_MODEL, totalMs: 75_000, maxRetries: 0 },
			{ model: FALLBACK_REVIEW_MODEL, totalMs: 60_000, maxRetries: 1 },
		];
		for (const { model, totalMs, maxRetries } of attempts) {
			try {
				const wait = await gateOf(this.ctx.exports, model).acquire();
				if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
				const { text } = await generateText({ model: ai(model as WorkersAIModelId), system, prompt, timeout: { totalMs }, maxRetries });
				try {
					const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
					return { summary: String(parsed.summary ?? ""), concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [] };
				} catch {
					return { summary: text.slice(0, 500), concerns: [] };
				}
			} catch (err) {
				errors.push(`${model}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
			}
		}
		return { summary: `No written review available (${errors.join("; ")}).`, concerns: [] };
	}
}
