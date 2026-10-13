// Who owns a piece of code right now, and who last changed it: the agent holding a live intent on
// the file or symbol, or the change that landed there last. Agents ask this instead of guessing.

import type { SymbolRef } from "../domain/types.ts";

export interface Claim {
	agentId: string;
	changeId: string;
	summary: string;
	paths: string[];
	symbols: SymbolRef[];
}

// "symbol" when the claim names the symbol itself; "path" when it only touches the file.
export function claimMatch(c: Pick<Claim, "paths" | "symbols">, path: string, name?: string): "symbol" | "path" | null {
	if (name && c.symbols.some((s) => s.path === path && (s.name === name || s.name.startsWith(`${name}.`) || name.startsWith(`${s.name}.`)))) return "symbol";
	if (c.paths.includes(path) || c.symbols.some((s) => s.path === path)) return "path";
	return null;
}

// The claims that match, the most specific first, without the asker's own change.
export function owners<T extends Claim>(claims: T[], path: string, name: string | undefined, askerChangeId: string): (T & { match: "symbol" | "path" })[] {
	return claims
		.filter((c) => c.changeId !== askerChangeId)
		.flatMap((c) => {
			const match = claimMatch(c, path, name);
			return match ? [{ ...c, match }] : [];
		})
		.sort((a, b) => (a.match === b.match ? 0 : a.match === "symbol" ? -1 : 1));
}
