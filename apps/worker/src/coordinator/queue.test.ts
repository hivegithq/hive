import { describe, expect, it } from "vitest";
import { orderQueue } from "./queue.ts";

const p = (changeId: string, submittedAt: number, paths: string[]) => ({ changeId, submittedAt, paths: new Set(paths) });

describe("orderQueue", () => {
	it("puts disjoint changes first, then overlapping ones in FIFO order", () => {
		const order = orderQueue([
			p("overlap-1", 1, ["src/cart.ts"]),
			p("disjoint", 3, ["src/readme.md"]),
			p("overlap-2", 2, ["src/cart.ts", "src/price.ts"]),
		]).map((x) => x.changeId);
		expect(order).toEqual(["disjoint", "overlap-1", "overlap-2"]);
	});
});
