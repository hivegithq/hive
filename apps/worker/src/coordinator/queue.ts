// Convergence queue ordering. Changes that share no paths with any other pending change
// land first (they can't conflict), then overlapping ones in submission order so each
// rebases onto the previous one's result.

export interface Pending {
	changeId: string;
	submittedAt: number;
	paths: Set<string>;
}

export function orderQueue(pending: Pending[]): Pending[] {
	const fifo = [...pending].sort((a, b) => a.submittedAt - b.submittedAt);
	const overlapsAny = (p: Pending) => fifo.some((o) => o !== p && [...p.paths].some((path) => o.paths.has(path)));
	const disjoint = fifo.filter((p) => !overlapsAny(p));
	const overlapping = fifo.filter((p) => overlapsAny(p));
	return [...disjoint, ...overlapping];
}
