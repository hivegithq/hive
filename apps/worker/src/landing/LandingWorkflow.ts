import { coordinatorOf, mergeBoxOf } from "../bindings.ts";
import { type WorkflowEvent, WorkflowEntrypoint, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import { createAI, type WorkersAIModelId } from "agents/models/ai-sdk";
import { generateText } from "ai";
import type { LandingParams } from "../coordinator/RepoCoordinator.ts";
import { decideLanding, type LandingVerdict, MAX_ATTEMPTS } from "../decide/policy.ts";
import type { EvidenceRun, PushResult, RebaseResult, ReferentialConflict } from "./MergeBox.ts";

const FALLBACK_REVIEW_MODEL = "@cf/zai-org/glm-4.7-flash";
const RETRY = { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "15 minutes" } as const satisfies WorkflowStepConfig;

// The convergence pipeline for one change: rebase → referential check → evidence → review → decide → land/bounce.
// In "evaluate" mode (race candidates) it stops after review and hands the result to the race judge.
export class LandingWorkflow extends WorkflowEntrypoint<Env, LandingParams> {
	async run(event: WorkflowEvent<LandingParams>, step: WorkflowStep) {
		const { repo, changeId, mode } = event.payload;
		const coordinator = coordinatorOf(this.ctx.exports, repo);
		// Landing uses one merge box per repo (it holds the trunk checkout); race evaluations run in parallel boxes.
		const box = mergeBoxOf(this.ctx.exports, mode === "land" ? repo : `${repo}:${changeId}`);

		const detail = await step.do("load change", async () => {
			const d = await coordinator.changeDetail(changeId);
			if (!d?.goal) throw new Error(`change ${changeId} not found`);
			return { change: d.change, goal: d.goal, intent: d.intent };
		});
		const { change, goal, intent } = detail;

		const rebase = await step.do("rebase onto trunk", RETRY, async (): Promise<RebaseResult> => {
			await box.prepare({ repo, fork: change.fork, canPush: mode === "land", previewRepo: change.race ? `${repo}.preview` : undefined });
			return box.rebase();
		});

		if (!rebase.ok) {
			await step.do("record merge conflict", async () => {
				await coordinator.recordEvidence({
					changeId,
					kind: "merge",
					command: "git rebase (mergiraf)",
					ok: false,
					output: rebase.conflicts.map((c) => `${c.path}\n${c.excerpt}`).join("\n\n"),
					commit: rebase.trunk,
				});
				const reason = `Rebasing onto trunk ${rebase.trunk.slice(0, 8)} left conflicts that structural merge could not resolve:\n\n${rebase.conflicts
					.map((c) => `### ${c.path}\n${c.excerpt}`)
					.join("\n\n")}`;
				const decision = { confidence: 1, probabilities: { bounce: 1 }, decidedBy: "hive:merge" };
				// Don't loop forever on a conflict the agent can't resolve: hand it to a person.
				if (change.attempts >= MAX_ATTEMPTS) {
					await coordinator.escalated(changeId, { ...decision, rationale: `Merge conflict persists after ${change.attempts} attempts.` });
				} else {
					await coordinator.bounced(changeId, reason, { ...decision, rationale: "Unresolvable merge conflict." });
				}
			});
			return { outcome: "bounce", reason: "conflict" };
		}

		await step.do("record merge", () =>
			coordinator.recordEvidence({
				changeId,
				kind: "merge",
				command: "git rebase (mergiraf)",
				ok: true,
				output: `Rebased onto ${rebase.trunk.slice(0, 8)} → ${rebase.head.slice(0, 8)}\n${rebase.files.join("\n")}`,
				commit: rebase.head,
			}),
		);

		const referential = await step.do("referential analysis", RETRY, (): Promise<ReferentialConflict[]> => box.referential());

		const evidence = await step.do("gather evidence", RETRY, async (): Promise<EvidenceRun[]> => {
			const runs = await box.evidence();
			for (const run of runs) await coordinator.recordEvidence({ changeId, ...run, commit: rebase.head });
			return runs;
		});

		if (change.race) {
			const race = change.race;
			await step.do("push preview", async () => {
				const r = await box.pushPreview({ previewRepo: `${repo}.preview`, branch: `race/${race.group}/${race.index}` });
				return { ok: r.ok, reason: r.reason };
			});
		}

		const conflicts = referential.map((r) =>
			r.direction === "trunk-uses-change"
				? `Trunk code ${r.affected} (changed since this work began) calls ${r.changed}, which this change modifies.`
				: `This change's ${r.changed} calls ${r.affected}, which trunk modified since this work began.`,
		);

		const review = await step.do("review", RETRY, async () => {
			const notes = await this.review(goal.title, goal.description, intent?.summary ?? "", rebase.structuralDiff || rebase.diff, conflicts);
			const verdict = await decideLanding(
				this.env.AI,
				{
					goal: `${goal.title}\n${goal.description}`,
					intent: intent?.summary ?? "",
					diff: rebase.diff.slice(0, 40000),
					evidence: evidence.map((e) => ({ kind: e.kind, ok: e.ok, output: e.output.slice(-1500) })),
					conflicts,
				},
				await coordinator.trust(change.agentId),
				change.attempts,
			);
			await coordinator.recordEvaluation({
				changeId,
				model: `${this.env.REVIEW_MODEL} + clef-flash`,
				score: verdict.reviewScore,
				summary: notes.summary,
				concerns: [...notes.concerns, ...conflicts],
			});
			return { verdict, notes };
		});

		if (mode === "evaluate") {
			await step.do("hand to race judge", () => coordinator.evaluated(changeId));
			return { outcome: "evaluated" };
		}

		const approvedByHuman = await step.do("check human approval", () => coordinator.humanApproved(changeId));
		const verdict: LandingVerdict = approvedByHuman ? { ...review.verdict, outcome: "land", rationale: "Approved by a human reviewer." } : review.verdict;
		const decision = {
			confidence: verdict.confidence,
			probabilities: verdict.probabilities,
			rationale: verdict.rationale,
			decidedBy: approvedByHuman ? "human" : "clef-flash",
		};

		if (verdict.outcome === "land") {
			const pushed = await step.do("push to trunk", RETRY, async (): Promise<PushResult> => {
				const first: PushResult = await box.push();
				if (first.ok) return first;
				// Trunk moved (e.g. a human pushed directly). Rebase again and retry once.
				const again: RebaseResult = await box.rebase();
				if (!again.ok) return { ok: false, reason: "trunk moved and the change no longer rebases cleanly" };
				return await box.push();
			});
			if (pushed.ok) {
				await step.do("mark landed", () => coordinator.landed(changeId, pushed.commit, decision));
				return { outcome: "land", commit: pushed.commit };
			}
			await step.do("bounce after failed push", () =>
				coordinator.bounced(changeId, `Could not land: ${pushed.reason}. Sync with trunk and resubmit.`, decision),
			);
			return { outcome: "bounce", reason: pushed.reason };
		}

		if (verdict.outcome === "bounce") {
			const failing = evidence.filter((e) => !e.ok);
			const reason = [
				verdict.rationale,
				...failing.map((e) => `\`${e.command}\` failed:\n${e.output.slice(-3000)}`),
				...(conflicts.length ? ["Referential conflicts:", ...conflicts] : []),
				...(review.notes.concerns.length ? ["Reviewer concerns:", ...review.notes.concerns.map((c: string) => `- ${c}`)] : []),
			].join("\n\n");
			await step.do("bounce", () => coordinator.bounced(changeId, reason, decision));
			return { outcome: "bounce" };
		}

		await step.do("escalate", () => coordinator.escalated(changeId, decision));
		return { outcome: "escalate" };
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
		for (const model of [this.env.REVIEW_MODEL, FALLBACK_REVIEW_MODEL]) {
			try {
				const { text } = await generateText({ model: ai(model as WorkersAIModelId), system, prompt, timeout: { totalMs: 120_000 }, maxRetries: 1 });
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
		// No written review; Clef still decides from the goal, diff and evidence.
		return { summary: `No written review available (${errors.join("; ")}).`, concerns: [] };
	}
}
