import { describe, expect, it } from "vitest";
import { decideLanding, landingOutcome } from "./policy.ts";

describe("landingOutcome", () => {
	it("lands when confident and trusted", () => {
		const r = landingOutcome({ probabilities: { land: 0.95, bounce: 0.03, escalate: 0.02 }, reviewScore: 1, trust: 1, evidenceOk: true });
		expect(r.outcome).toBe("land");
	});

	it("lands a confident verdict from a moderately trusted agent", () => {
		const r = landingOutcome({ probabilities: { land: 0.89, bounce: 0.06, escalate: 0.05 }, reviewScore: 0.8, trust: 0.8, evidenceOk: true });
		expect(r.outcome).toBe("land");
	});

	it("escalates a confident verdict from a low-trust agent", () => {
		const r = landingOutcome({ probabilities: { land: 0.95, bounce: 0.03, escalate: 0.02 }, reviewScore: 1, trust: 0.2, evidenceOk: true });
		expect(r.outcome).toBe("escalate");
	});

	it("bounces whenever deterministic evidence failed, regardless of Clef", () => {
		const r = landingOutcome({ probabilities: { land: 0.99 }, reviewScore: 1, trust: 1, evidenceOk: false });
		expect(r.outcome).toBe("bounce");
	});

	it("bounces when Clef prefers bounce", () => {
		const r = landingOutcome({ probabilities: { land: 0.2, bounce: 0.7, escalate: 0.1 }, reviewScore: 0.5, trust: 1, evidenceOk: true });
		expect(r.outcome).toBe("bounce");
	});

	it("escalates instead of auto-landing when there is a referential conflict", () => {
		const r = landingOutcome({ probabilities: { land: 0.95 }, reviewScore: 1, trust: 1, evidenceOk: true, conflicts: 1 });
		expect(r.outcome).toBe("escalate");
	});

	it("escalates instead of bouncing forever", () => {
		const r = landingOutcome({ probabilities: { land: 0.2, bounce: 0.7 }, reviewScore: 0.5, trust: 1, evidenceOk: true, attempts: 3 });
		expect(r.outcome).toBe("escalate");
	});

	it("escalates when uncertain", () => {
		const r = landingOutcome({ probabilities: { land: 0.6, bounce: 0.3, escalate: 0.1 }, reviewScore: 0.7, trust: 1, evidenceOk: true });
		expect(r.outcome).toBe("escalate");
	});
});

describe("decideLanding", () => {
	it("sends typed questions and normalizes the review score", async () => {
		let sent: any;
		const ai = {
			async run(_model: string, inputs: any) {
				sent = inputs;
				return {
					model: "clef-flash",
					usage: { input_tokens: 1, output_tokens: 0 },
					answers: {
						review: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 0.9 },
						decision: { type: "choice", choice: "land", probabilities: { land: 0.9, bounce: 0.05, escalate: 0.05 }, confidence: 0.9 },
					},
				};
			},
		};
		const v = await decideLanding(ai, { goal: "g", intent: "i", diff: "d", evidence: [{ kind: "test", ok: true, output: "" }], conflicts: [] }, 1);
		expect(sent.model).toBe("clef-flash");
		expect(Object.keys(sent.questions)).toEqual(["review", "decision"]);
		expect(v).toMatchObject({ outcome: "land", reviewScore: 0.75 });
	});
});
