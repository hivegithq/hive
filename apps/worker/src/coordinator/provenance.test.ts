import { describe, expect, it } from "vitest";
import { provenance } from "./provenance.ts";

describe("provenance", () => {
	const goals = [
		{ id: "g1", title: "Fix parsing", status: "achieved", parentId: null, createdAt: 100 },
		{ id: "g1a", title: "Add a test", status: "achieved", parentId: "g1", createdAt: 110 },
		{ id: "g2", title: "Docs", status: "open", parentId: null, createdAt: 50 },
	];
	const changes = [
		{ id: "c1", goalId: "g1a", model: "kimi", status: "archived", createdAt: 120, submittedAt: 130 },
		{ id: "c2", goalId: "g1a", model: "deepseek", status: "landed", createdAt: 200, submittedAt: 210 },
	];
	const decisions = [
		{ changeId: "c1", outcome: "bounce", decidedBy: "hive:evidence", rationale: "Tests failed.\nmore", createdAt: 140 },
		{ changeId: "c2", outcome: "land", decidedBy: "clef-flash", rationale: "Clef land=0.9", createdAt: 220 },
	];
	const h = provenance({ goals, changes, decisions, prs: { g1: { url: "https://github.com/o/r/pull/3", number: 3 } }, costByGoal: { g1a: 0.4, g1: 0.1 } });

	it("groups a plan's sub-goals' attempts under their goal, newest activity first", () => {
		expect(h.map((x) => x.goal.id)).toEqual(["g1", "g2"]);
		expect(h[0].subgoals.map((g) => g.id)).toEqual(["g1a"]);
		expect(h[0].attempts.map((a) => a.changeId)).toEqual(["c1", "c2"]);
		expect(h[0].cost).toBeCloseTo(0.5);
		expect(h[0].pr?.number).toBe(3);
	});

	it("tells each attempt's story in order", () => {
		expect(h[0].attempts[0].steps.map((s) => s.kind)).toEqual(["started", "submitted", "bounce"]);
		expect(h[0].attempts[0].steps[2].text).toBe("Tests failed.");
		expect(h[0].attempts[1].steps.at(-1)).toMatchObject({ kind: "land", by: "clef-flash" });
		expect(h[1].attempts).toEqual([]);
	});
});
