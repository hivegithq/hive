import { describe, expect, it } from "vitest";
import { budgetExceeded, type GoalNode, treeSpend } from "./costs.ts";

const goals: GoalNode[] = [
	{ id: "plan", parentId: null, budget: 5 },
	{ id: "a", parentId: "plan", budget: null },
	{ id: "b", parentId: "plan", budget: 1 },
	{ id: "solo", parentId: null, budget: null },
];

describe("costs", () => {
	it("rolls sub-goal spend up into the plan", () => {
		const spend = treeSpend(goals, new Map([["plan", 0.5], ["a", 2], ["b", 0.75], ["solo", 3]]));
		expect(spend.get("plan")).toBeCloseTo(3.25);
		expect(spend.get("a")).toBe(2);
	});

	it("stops at the first budget reached, own or inherited", () => {
		const spend = treeSpend(goals, new Map([["a", 4], ["b", 1.2]]));
		expect(budgetExceeded("b", goals, spend, null)).toEqual({ goalId: "b", limit: 1, spent: 1.2 });
		expect(budgetExceeded("a", goals, spend, null)?.goalId).toBe("plan");
		expect(budgetExceeded("a", goals, treeSpend(goals, new Map([["a", 1]])), null)).toBeNull();
	});

	it("applies the repository's default budget to root goals only", () => {
		const spend = treeSpend(goals, new Map([["solo", 3]]));
		expect(budgetExceeded("solo", goals, spend, 2)).toEqual({ goalId: "solo", limit: 2, spent: 3 });
		expect(budgetExceeded("solo", goals, spend, null)).toBeNull();
		// A plan's own budget wins over the default.
		expect(budgetExceeded("a", goals, treeSpend(goals, new Map([["a", 3]])), 2)).toBeNull();
	});
});
