import { describe, expect, it } from "vitest";
import { containerCost, modelCost, usd } from "./pricing.ts";

describe("pricing", () => {
	it("prices tokens per million, both directions", () => {
		// The measured uuid agent: ~150k in, ~5k out on Kimi K2.7 ≈ $0.16.
		expect(modelCost("@cf/moonshotai/kimi-k2.7-code", 150_000, 5_000)).toBeCloseTo(0.1625, 4);
		expect(modelCost("unknown/model", 1e6, 1e6)).toBe(0);
	});

	it("prices container time by instance", () => {
		expect(containerCost("standard-4", 3600)).toBeCloseTo(0.396, 3);
		expect(containerCost("standard-1", 3600)).toBeCloseTo(0.072, 3);
	});

	it("formats dollars", () => {
		expect(usd(0)).toBe("$0");
		expect(usd(0.004)).toBe("<$0.01");
		expect(usd(1.237)).toBe("$1.24");
	});
});
