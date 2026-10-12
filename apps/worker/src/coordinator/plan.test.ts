import { describe, expect, it } from "vitest";
import { modelForSubgoal, type PlannedGoal, readPlanSettings, validatePlan } from "./plans.ts";

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

	it("reads plans saved before agentModels existed", () => {
		expect(readPlanSettings(JSON.stringify({ model: "glm", agentModel: "kimi", maxParallel: 4 }), "default")).toEqual({ model: "glm", agentModels: ["kimi"], maxParallel: 4 });
		expect(readPlanSettings(JSON.stringify({ model: "glm", agentModels: ["a", "b"], maxParallel: 2 }), "default").agentModels).toEqual(["a", "b"]);
		expect(readPlanSettings("{}", "default").agentModels).toEqual(["default"]);
	});
});
