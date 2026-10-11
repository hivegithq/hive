import { describe, expect, it } from "vitest";
import type { Intent, SymbolRef } from "../domain/types.ts";
import { memorySql } from "../test/sql.ts";
import { INTENT_SCHEMA, IntentStore } from "./intents.ts";
import { detectOverlaps } from "./overlap.ts";
import { SCHEMA } from "./schema.ts";

const sym = (path: string, name: string): SymbolRef => ({ path, name });
let n = 0;
const intent = (paths: string[], symbols: SymbolRef[], changeId = `c-${++n}`): Intent => ({
	id: `i-${++n}`,
	changeId,
	agentId: `a-${n}`,
	summary: "",
	paths,
	symbols,
	createdAt: n,
	releasedAt: null,
});

function store() {
	const db = memorySql();
	for (const s of [...SCHEMA, ...INTENT_SCHEMA]) db.exec(s);
	return new IntentStore(db);
}

// checkout() in src/checkout.ts calls total() in src/cart.ts
const graph = {
	dependentsOf: (s: SymbolRef) => (s.name === "total" ? [sym("src/checkout.ts", "checkout")] : []),
	dependenciesOf: (s: SymbolRef) => (s.name === "checkout" ? [sym("src/cart.ts", "total")] : []),
};

describe("IntentStore.candidates", () => {
	it("returns only intents in the same or related files", () => {
		const s = store();
		s.insert(intent(["src/cart.ts"], [sym("src/cart.ts", "add")]));
		s.insert(intent([], [sym("src/checkout.ts", "checkout")]));
		s.insert(intent(["docs/README.md"], []));
		const mine = intent([], [sym("src/cart.ts", "total")]);
		const found = s.candidates(mine, graph);
		expect(found.map((i) => touchedOf(i)).sort()).toEqual(["src/cart.ts", "src/checkout.ts"]);
		expect(detectOverlaps(mine, found, graph).map((o) => o.level).sort()).toEqual(["referential", "textual"]);
	});

	it("forgets released intents", () => {
		const s = store();
		const a = intent(["src/a.ts"], []);
		s.insert(a);
		s.release(a.changeId, 99);
		expect(s.candidates(intent(["src/a.ts"], []), graph)).toEqual([]);
		expect(s.liveCount()).toBe(0);
	});

	it("stays fast with many live intents", () => {
		const s = store();
		for (let i = 0; i < 20_000; i++) s.insert(intent([`agents/a${i}.ts`], [sym(`agents/a${i}.ts`, "run")]));
		s.insert(intent(["src/shared.ts"], []));
		const t0 = performance.now();
		for (let i = 0; i < 1_000; i++) s.candidates(intent(["src/shared.ts", `agents/new${i}.ts`], []), graph);
		const perCheck = (performance.now() - t0) / 1_000;
		expect(s.candidates(intent(["src/shared.ts"], []), graph)).toHaveLength(1);
		expect(perCheck).toBeLessThan(2); // ms per overlap check with 20k live intents
	});
});

const touchedOf = (i: Intent) => [...new Set([...i.paths, ...i.symbols.map((s) => s.path)])].join(",");
