import type { DecisionOutcome, Overlap } from "../domain/types.ts";
import { type AiRunner, askClef } from "./clef.ts";

// Auto-land only when Clef is at least this sure (writ's convergence threshold),
// further capped by how much we trust the agent that wrote the change.
export const AUTO_LAND_THRESHOLD = 0.85;
// After this many submissions, a change that would bounce again goes to a person instead.
export const MAX_ATTEMPTS = 3;

export interface LandingVerdict {
	outcome: Extract<DecisionOutcome, "land" | "bounce" | "escalate">;
	confidence: number;
	probabilities: Record<string, number>;
	reviewScore: number; // 0..1, normalized from Clef's 0..4 rubric
	rationale: string;
}

// Pure policy: turn Clef's probabilities into an outcome.
export function landingOutcome(input: {
	probabilities: Record<string, number>;
	reviewScore: number;
	trust: number;
	evidenceOk: boolean;
	conflicts?: number; // referential conflicts: semantic coupling a person should look at
	attempts?: number; // how many times this change has been submitted
}): Pick<LandingVerdict, "outcome" | "confidence" | "rationale"> {
	const pLand = input.probabilities.land ?? 0;
	const pBounce = input.probabilities.bounce ?? 0;
	// Trust discounts Clef's confidence: a fully trusted agent keeps it all, an untrusted one
	// loses up to 15%, which puts auto-landing out of reach unless Clef is near certain.
	const effective = pLand * (0.85 + 0.15 * Math.min(1, Math.max(0, input.trust)));

	if (!input.evidenceOk) {
		if ((input.attempts ?? 1) >= MAX_ATTEMPTS) {
			return { outcome: "escalate", confidence: 1, rationale: `Tests or checks still fail on attempt ${input.attempts}; asking a person instead of looping.` };
		}
		return { outcome: "bounce", confidence: 1, rationale: "Tests or checks failed, so this can't land. Returning it to the agent with the output." };
	}
	const conflicts = input.conflicts ?? 0;
	if (effective >= AUTO_LAND_THRESHOLD && conflicts > 0) {
		return {
			outcome: "escalate",
			confidence: pLand,
			rationale: `Clef would land (${fmt(pLand)}), but ${conflicts} referential conflict(s) couple this change to code trunk changed meanwhile. A person should confirm.`,
		};
	}
	if (effective >= AUTO_LAND_THRESHOLD) {
		return { outcome: "land", confidence: pLand, rationale: `Clef land=${fmt(pLand)} (trust-adjusted ${fmt(effective)}) ≥ ${AUTO_LAND_THRESHOLD}.` };
	}
	if (pBounce >= pLand && pBounce >= 0.5) {
		if ((input.attempts ?? 1) >= MAX_ATTEMPTS) {
			return { outcome: "escalate", confidence: pBounce, rationale: `Clef prefers bounce (${fmt(pBounce)}), but this is attempt ${input.attempts}; asking a person instead of looping.` };
		}
		return { outcome: "bounce", confidence: pBounce, rationale: `Clef prefers bounce (${fmt(pBounce)}); returning to the agent with context.` };
	}
	return {
		outcome: "escalate",
		confidence: Math.max(pLand, pBounce),
		rationale: `Clef is not confident enough (land=${fmt(pLand)}, trust-adjusted ${fmt(effective)}); asking a human.`,
	};
}

export async function decideLanding(
	ai: AiRunner,
	state: { goal: string; intent: string; diff: string; evidence: { kind: string; ok: boolean; output: string }[]; conflicts: string[] },
	trust: number,
	attempts = 1,
): Promise<LandingVerdict> {
	const { answers } = await askClef(ai, state, {
		review: {
			type: "score",
			instructions: "Rate how well the diff accomplishes the goal and stated intent, with correct, focused, maintainable code.",
			criteria: ["Wrong or harmful", "Misses the goal", "Partially correct", "Correct with minor issues", "Correct and clean"],
		},
		decision: {
			type: "choice",
			instructions:
				"Should this change be merged into trunk now? Consider the goal, intent, diff, test/typecheck evidence, and any merge conflicts.",
			criteria: {
				land: "Safe to merge: accomplishes the intent, evidence passes, no unresolved conflicts.",
				bounce: "Return to the agent: fixable problems such as failing evidence, conflicts, or scope creep.",
				escalate: "A human must decide: risky, ambiguous, or out-of-scope changes.",
			},
		},
	});
	const reviewScore = answers.review.score / 4;
	// Only deterministic results count as evidence. Referential conflicts are a signal for review.
	const evidenceOk = state.evidence.every((e) => e.ok);
	const verdict = landingOutcome({
		probabilities: answers.decision.probabilities,
		reviewScore,
		trust,
		evidenceOk,
		conflicts: state.conflicts.length,
		attempts,
	});
	return { ...verdict, probabilities: answers.decision.probabilities, reviewScore };
}

export type OverlapAction = "proceed" | "narrow" | "wait" | "negotiate";

export async function adviseOnOverlap(
	ai: AiRunner,
	state: { mine: string; overlaps: Overlap[] },
): Promise<{ severity: number; action: OverlapAction; probabilities: Record<string, number> }> {
	const { answers } = await askClef(ai, state, {
		severity: {
			type: "score",
			instructions: "How likely are these two pieces of concurrent work to conflict or break each other?",
			criteria: ["Independent", "Cosmetic overlap", "Likely merge conflict", "Semantic conflict: one breaks the other"],
		},
		action: {
			type: "choice",
			instructions: "What should the agent declaring the new intent do?",
			criteria: {
				proceed: "Overlap is harmless; continue.",
				narrow: "Reduce scope to avoid the other agent's symbols.",
				wait: "Wait for the other change to land, then rebase.",
				negotiate: "Message the other agent to agree on an interface first.",
			},
		},
	});
	return {
		severity: answers.severity.score / 3,
		action: answers.action.choice as OverlapAction,
		probabilities: answers.action.probabilities,
	};
}

export async function judgeRace(
	ai: AiRunner,
	goal: string,
	candidates: { changeId: string; summary: string; diff: string; evidenceOk: boolean; reviewScore: number }[],
): Promise<{ winner: string; confidence: number; probabilities: Record<string, number> }> {
	const criteria = Object.fromEntries(
		candidates.map((c) => [c.changeId, { summary: c.summary, evidenceOk: c.evidenceOk, reviewScore: c.reviewScore }]),
	);
	const { answers } = await askClef(ai, { goal, candidates }, {
		winner: {
			type: "choice",
			instructions:
				"Several agents attempted the same goal. Pick the change that best accomplishes it. Prefer passing evidence, then correctness, then simplicity.",
			criteria,
		},
	});
	return { winner: answers.winner.choice, confidence: answers.winner.confidence, probabilities: answers.winner.probabilities };
}

const fmt = (n: number) => n.toFixed(2);
