import type { Intent, Overlap, SymbolRef } from "../domain/types.ts";

// The slice of the semantic index overlap detection needs:
// for a symbol, which other symbols reference (call/import/extend) it.
export interface ReferenceGraph {
	dependentsOf(symbol: SymbolRef): SymbolRef[];
}

export const symbolKey = (s: SymbolRef) => `${s.path}#${s.name}`;

// Compare a new intent against the live ones. Reports the strongest level per
// other intent: structural (same symbol) > referential (one calls the other) > textual (same file).
export function detectOverlaps(candidate: Intent, live: Intent[], graph: ReferenceGraph): Overlap[] {
	const mySymbols = new Set(candidate.symbols.map(symbolKey));
	const myPaths = new Set([...candidate.paths, ...candidate.symbols.map((s) => s.path)]);
	const myDependents = new Set(candidate.symbols.flatMap((s) => graph.dependentsOf(s)).map(symbolKey));

	const overlaps: Overlap[] = [];
	for (const other of live) {
		if (other.id === candidate.id || other.releasedAt !== null) continue;

		const sharedSymbols = other.symbols.map(symbolKey).filter((k) => mySymbols.has(k));
		if (sharedSymbols.length > 0) {
			overlaps.push(overlap("structural", other, sharedSymbols));
			continue;
		}

		const referential: string[] = [];
		for (const theirs of other.symbols) {
			// They edit something that calls what I edit.
			if (myDependents.has(symbolKey(theirs))) referential.push(`${symbolKey(theirs)} → mine`);
			// I edit something that calls what they edit.
			for (const dep of graph.dependentsOf(theirs)) {
				if (mySymbols.has(symbolKey(dep))) referential.push(`${symbolKey(dep)} → ${symbolKey(theirs)}`);
			}
		}
		if (referential.length > 0) {
			overlaps.push(overlap("referential", other, referential));
			continue;
		}

		const otherPaths = [...other.paths, ...other.symbols.map((s) => s.path)];
		const sharedPaths = [...new Set(otherPaths.filter((p) => myPaths.has(p)))];
		if (sharedPaths.length > 0) overlaps.push(overlap("textual", other, sharedPaths));
	}
	return overlaps;
}

function overlap(level: Overlap["level"], other: Intent, detail: string[]): Overlap {
	return {
		level,
		otherIntentId: other.id,
		otherAgentId: other.agentId,
		otherSummary: other.summary,
		detail,
	};
}

// Paths two intents both touch; used to order the convergence queue (disjoint first).
export function touchedPaths(intent: Pick<Intent, "paths" | "symbols">): Set<string> {
	return new Set([...intent.paths, ...intent.symbols.map((s) => s.path)]);
}
