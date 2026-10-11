import { describe, expect, it } from "vitest";
import { type PlannedGoal, validatePlan } from "./plans.ts";

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
