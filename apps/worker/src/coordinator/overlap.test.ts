import { describe, expect, it } from "vitest";
import type { Intent, SymbolRef } from "../domain/types.ts";
import { detectOverlaps, type ReferenceGraph, symbolKey } from "./overlap.ts";

const sym = (path: string, name: string): SymbolRef => ({ path, name });

function intent(id: string, paths: string[], symbols: SymbolRef[]): Intent {
	return { id, changeId: `c-${id}`, agentId: `a-${id}`, summary: id, paths, symbols, createdAt: 0, releasedAt: null };
}

// checkout() calls total(); total() calls price()
const graph: ReferenceGraph = {
	dependentsOf(s) {
		const edges: Record<string, SymbolRef[]> = {
			"src/cart.ts#total": [sym("src/checkout.ts", "checkout")],
			"src/price.ts#price": [sym("src/cart.ts", "total")],
		};
		return edges[symbolKey(s)] ?? [];
	},
};

describe("detectOverlaps", () => {
	it("flags the same symbol as structural", () => {
		const a = intent("a", [], [sym("src/cart.ts", "total")]);
		const b = intent("b", [], [sym("src/cart.ts", "total")]);
		expect(detectOverlaps(a, [b], graph).map((o) => o.level)).toEqual(["structural"]);
	});

	it("flags a caller of my symbol as referential", () => {
		const mine = intent("a", [], [sym("src/cart.ts", "total")]);
		const theirs = intent("b", [], [sym("src/checkout.ts", "checkout")]);
		const [o] = detectOverlaps(mine, [theirs], graph);
		expect(o.level).toBe("referential");
		expect(o.detail).toEqual(["src/checkout.ts#checkout → mine"]);
	});

	it("flags my symbol calling theirs as referential", () => {
		const mine = intent("a", [], [sym("src/cart.ts", "total")]);
		const theirs = intent("b", [], [sym("src/price.ts", "price")]);
		expect(detectOverlaps(mine, [theirs], graph)[0].level).toBe("referential");
	});

	it("flags different symbols in one file as textual", () => {
		const a = intent("a", [], [sym("src/cart.ts", "total")]);
		const b = intent("b", ["src/cart.ts"], [sym("src/cart.ts", "addItem")]);
		expect(detectOverlaps(a, [b], graph)[0]).toMatchObject({ level: "textual", detail: ["src/cart.ts"] });
	});

	it("ignores disjoint and released intents", () => {
		const a = intent("a", ["src/a.ts"], []);
		const disjoint = intent("b", ["src/b.ts"], []);
		const released = { ...intent("c", ["src/a.ts"], []), releasedAt: 1 };
		expect(detectOverlaps(a, [disjoint, released], graph)).toEqual([]);
	});
});
