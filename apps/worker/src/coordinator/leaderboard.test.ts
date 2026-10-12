import { describe, expect, it } from "vitest";
import { leaderboard } from "./leaderboard.ts";

describe("leaderboard", () => {
	const min = 60_000;
	const changes = [
		{ id: "k1", model: "kimi", status: "landed", createdAt: 0 },
		{ id: "k2", model: "kimi", status: "landed", createdAt: 0 },
		{ id: "k3", model: "kimi", status: "archived", createdAt: 0 },
		{ id: "d1", model: "deepseek", status: "escalated", createdAt: 0 },
		{ id: "s1", model: "sim", status: "landed", createdAt: 0 },
	];
	const decisions = [
		{ changeId: "k1", outcome: "bounce", createdAt: 5 * min },
		{ changeId: "k1", outcome: "land", createdAt: 20 * min },
		{ changeId: "k2", outcome: "land", createdAt: 10 * min },
		{ changeId: "d1", outcome: "escalate", createdAt: 30 * min },
	];
	const stats = leaderboard(changes, decisions, new Map([["k1", 0.5], ["k2", 0.3], ["k3", 0.2], ["d1", 0.4]]));

	it("counts per model and leaves simulated agents out", () => {
		expect(stats.map((s) => s.model)).toEqual(["kimi", "deepseek"]);
		const kimi = stats[0];
		expect([kimi.started, kimi.landed, kimi.bounces, kimi.escalations]).toEqual([3, 2, 1, 0]);
		expect(kimi.landingRate).toBeCloseTo(2 / 3);
		expect(kimi.medianMinutesToLand).toBe(10);
	});

	it("spreads all of a model's spend over what it landed", () => {
		expect(stats[0].costPerLanded).toBeCloseTo(0.5);
		expect(stats[1].costPerLanded).toBeNull();
		expect(stats[1].escalations).toBe(1);
	});
});
