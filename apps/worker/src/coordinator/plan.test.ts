import { describe, expect, it } from "vitest";
import { modelForSubgoal, nextSubgoal, type PlannedGoal, readPlanSettings, validatePlan } from "./plans.ts";

const g = (key: string, dependsOn: string[] = []): PlannedGoal => ({ key, title: key, description: key, dependsOn });

describe("validatePlan", () => {
	it("accepts a dependency graph without cycles", () => {
		expect(validatePlan([g("tests"), g("port-a", ["tests"]), g("port-b", ["tests"]), g("remove-old", ["port-a", "port-b"])])).toBeNull();
	});
	it("rejects empty plans, duplicate keys and unknown dependencies", () => {
		expect(validatePlan([])).toMatch(/at least one/);
		expect(validatePlan([g("a"), g("a")])).toMatch(/duplicate key a/);
		expect(validatePlan([g("a", ["zz"])])).toMatch(/unknown zz/);
	});
	it("rejects cycles, including long ones", () => {
		expect(validatePlan([g("a", ["b"]), g("b", ["a"])])).toMatch(/cycle/);
		expect(validatePlan([g("a", ["c"]), g("b", ["a"]), g("c", ["b"]), g("d")])).toMatch(/cycle/);
		expect(validatePlan([g("a", ["a"])])).toMatch(/cycle/);
	});
});

describe("plan models", () => {
	it("spreads sub-goals across the agent models in turn", () => {
		const models = ["kimi", "deepseek", "gpt"];
		expect([0, 1, 2, 3, 4].map((i) => modelForSubgoal(models, i))).toEqual(["kimi", "deepseek", "gpt", "kimi", "deepseek"]);
		expect(modelForSubgoal(["only"], 7)).toBe("only");
	});

	it("reads scout settings", () => {
		const s = readPlanSettings(JSON.stringify({ model: "glm", agentModels: ["a"], scouts: true, scoutModel: "cheap" }), "default");
		expect([s.scouts, s.scoutModel]).toEqual([true, "cheap"]);
	});

	it("reads plans saved before agentModels existed", () => {
		expect(readPlanSettings(JSON.stringify({ model: "glm", agentModel: "kimi", maxParallel: 4 }), "default")).toEqual({ model: "glm", agentModels: ["kimi"], maxParallel: 4, scouts: false, scoutModel: "default" });
		expect(readPlanSettings(JSON.stringify({ model: "glm", agentModels: ["a", "b"], maxParallel: 2 }), "default").agentModels).toEqual(["a", "b"]);
		expect(readPlanSettings("{}", "default").agentModels).toEqual(["default"]);
	});
});

describe("nextSubgoal", () => {
	const g = (id: string, status: string, dependsOn: string[] = []) => ({ id, status, dependsOn });

	it("starts the first open sub-goal whose dependencies have landed", () => {
		expect(nextSubgoal([g("a", "achieved"), g("b", "open", ["a"]), g("c", "open")], 4)).toBe("b");
		expect(nextSubgoal([g("a", "in_progress"), g("b", "open", ["a"]), g("c", "open")], 4)).toBe("c");
	});

	it("never picks a sub-goal that's already started, and respects the limit", () => {
		expect(nextSubgoal([g("a", "in_progress"), g("b", "in_progress")], 2)).toBeNull();
		expect(nextSubgoal([g("a", "in_progress"), g("b", "open")], 1)).toBeNull();
		expect(nextSubgoal([g("a", "achieved"), g("b", "in_progress", ["a"])], 4)).toBeNull();
	});
});
