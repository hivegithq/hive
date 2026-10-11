import type { EvidenceRun, Stacked, StackResult } from "./MergeBox.ts";

// Batch landing (the Bors/Zuul idea): stack many queued changes on trunk and verify them once.
// If the stack fails, halve it until a prefix passes; a single failing change is the culprit.
// Every batch makes progress: something lands, or the culprit is sent back.

export interface Attempt {
	stack: StackResult;
	evidence: EvidenceRun[];
}

// Stack `changeIds` (in order) on trunk and gather evidence for the result.
export type AttemptFn = (label: string, changeIds: string[]) => Promise<Attempt>;

export interface BatchOutcome {
	attempt: Attempt | null; // the stack whose evidence passed, if any
	land: string[]; // changes in that passing stack
	conflicted: Extract<Stacked, { conflicts: unknown }>[]; // didn't apply onto trunk
	empty: string[]; // no commits of their own
	culprit: { changeId: string; evidence: EvidenceRun[] } | null; // fails on its own
	requeue: string[]; // untested because of the culprit; try again next batch
}

export const evidenceOk = (runs: EvidenceRun[]) => runs.every((r) => r.ok);

export async function findLandable(attempt: AttemptFn, changeIds: string[]): Promise<BatchOutcome> {
	const first = await attempt("all", changeIds);
	const conflicted = first.stack.entries.filter((e): e is Extract<Stacked, { conflicts: unknown }> => !e.ok && "conflicts" in e);
	const empty = first.stack.entries.filter((e) => !e.ok && "empty" in e).map((e) => e.changeId);
	const applied = first.stack.entries.filter((e) => e.ok).map((e) => e.changeId);
	const base = { conflicted, empty };

	if (applied.length === 0) return { ...base, attempt: null, land: [], culprit: null, requeue: [] };
	if (evidenceOk(first.evidence)) return { ...base, attempt: first, land: applied, culprit: null, requeue: [] };

	// Halve until a prefix passes. Prefixes of an applied order apply cleanly again.
	let prefix = applied;
	let failing = first;
	while (prefix.length > 1) {
		prefix = prefix.slice(0, Math.ceil(prefix.length / 2));
		const a = await attempt(`first ${prefix.length}`, prefix);
		if (evidenceOk(a.evidence)) {
			return { ...base, attempt: a, land: prefix, culprit: null, requeue: applied.filter((id) => !prefix.includes(id)) };
		}
		failing = a;
	}
	const culprit = prefix[0];
	return { ...base, attempt: null, land: [], culprit: { changeId: culprit, evidence: failing.evidence }, requeue: applied.filter((id) => id !== culprit) };
}

// Choose the next batch from the queue (oldest first): changes touching no file another selected change
// touches go in first, so most of a batch can't conflict; then fill up in submission order.
export function selectBatch(queue: { changeId: string; paths: string[] }[], max: number): string[] {
	const chosen: string[] = [];
	const used = new Set<string>();
	const deferred: string[] = [];
	for (const q of queue) {
		if (chosen.length >= max) break;
		if (q.paths.some((p) => used.has(p))) {
			deferred.push(q.changeId);
			continue;
		}
		chosen.push(q.changeId);
		for (const p of q.paths) used.add(p);
	}
	for (const id of deferred) {
		if (chosen.length >= max) break;
		chosen.push(id);
	}
	return chosen;
}
