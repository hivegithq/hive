import { describe, expect, it } from "vitest";
import { type PrGoal, prBody, prTitle } from "./pr.ts";

const goal: PrGoal = {
	id: "g-1",
	title: "Parsing is too lenient (#60)",
	description: "From GitHub issue …",
	issue: { ref: "google/uuid#60", url: "https://github.com/google/uuid/issues/60" },
	subgoals: [],
	changes: [
		{
			id: "c-1",
			model: "Kimi K2.7 Code",
			evidence: [
				{ command: "go test ./...", ok: true },
				{ command: "go vet ./...", ok: true },
			],
			decision: { rationale: "Clef land=0.91", decidedBy: "clef-flash", confidence: 0.91 },
			cost: 0.21,
		},
	],
	dashboard: "https://hivegit.dev/r/uuid",
};

describe("pull request", () => {
	it("closes the issue when it's in the same repository", () => {
		expect(prTitle(goal)).toBe("Parsing is too lenient");
		const body = prBody(goal, true);
		expect(body.startsWith("Fixes #60")).toBe(true);
		expect(body).toContain("`go test ./...`");
		expect(body).toContain("clef-flash (91%)");
		expect(body).toContain("≈$0.21");
	});

	it("links instead when the issue lives elsewhere", () => {
		expect(prBody(goal, false).startsWith("For https://github.com/google/uuid/issues/60")).toBe(true);
	});
});
