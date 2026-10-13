import { describe, expect, it } from "vitest";
import { describeEvery, dueNow, nextAfter, parseEvery } from "./recurring.ts";

describe("recurring goals", () => {
	it("reads intervals", () => {
		expect(parseEvery("daily")).toBe(1440);
		expect(parseEvery("every 6h")).toBe(360);
		expect(parseEvery("2d")).toBe(2880);
		expect(parseEvery("weekly")).toBe(10080);
		expect(parseEvery("90m")).toBe(90);
		expect(parseEvery("30m")).toBeNull(); // under an hour
		expect(parseEvery("sometimes")).toBeNull();
		expect(describeEvery(1440)).toBe("every 1 day");
		expect(describeEvery(360)).toBe("every 6 hours");
	});

	it("runs what's due, skips while the last run is going, ignores disabled", () => {
		const now = 1_000_000;
		const s = (id: string, o: Partial<Parameters<typeof dueNow>[0][number]> = {}) => ({ id, enabled: true, everyMinutes: 60, nextRun: now - 1, lastGoalStatus: null, ...o });
		const r = dueNow([s("a"), s("b", { lastGoalStatus: "in_progress" }), s("c", { lastGoalStatus: "achieved" }), s("d", { enabled: false }), s("e", { nextRun: now + 5 })], now);
		expect(r.run).toEqual(["a", "c"]);
		expect(r.skipped).toEqual(["b"]);
		expect(nextAfter(now, 60)).toBe(now + 3_600_000);
	});
});
