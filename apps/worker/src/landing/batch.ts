import type { EvidenceRun, Stacked, StackResult } from "./MergeBox.ts";

// Batch landing (the Bors/Zuul idea): stack many queued changes on trunk and verify them once.
// If the stack fails, divide and conquer: keep every half that verifies, recurse into halves that
// don't, until each failing change is isolated. Everything good in the batch lands in this batch;
// k broken changes in n cost about k·log2(n) extra verifications.

export interface Attempt {
	stack: StackResult;
	evidence: EvidenceRun[];
}

// Stack `changeIds` (in order) on trunk and gather evidence for the result.
export type AttemptFn = (label: string, changeIds: string[]) => Promise<Attempt>;

type Conflicted = Extract<Stacked, { conflicts: unknown }>;

export interface BatchOutcome {
	attempt: Attempt | null; // the verified stack of exactly `land`, if anything lands
	land: string[];
	conflicted: Conflicted[]; // didn't apply onto trunk (or onto the changes ahead of them)
	empty: string[]; // no commits of their own
	culprits: { changeId: string; evidence: EvidenceRun[] }[]; // fail verification on their own
	requeue: string[]; // reserved: untested changes (none with divide and conquer)
	trunkRed: { commit: string; evidence: EvidenceRun[] } | null; // trunk fails on its own: blame no one
}

export const evidenceOk = (runs: EvidenceRun[]) => runs.every((r) => r.ok);

export async function findLandable(attempt: AttemptFn, changeIds: string[]): Promise<BatchOutcome> {
	const conflicted: Conflicted[] = [];
	const empty: string[] = [];
	const culprits: BatchOutcome["culprits"] = [];
	let accepted: string[] = [];
	let verified: Attempt | null = null;
	let n = 0;

	// Run an attempt and drop any change that no longer applies (e.g. it built on a culprit).
	const run = async (candidates: string[]) => {
		const a = await attempt(`#${++n} ${accepted.length}+${candidates.length}`, [...accepted, ...candidates]);
		for (const e of a.stack.entries) {
			if (e.ok || !candidates.includes(e.changeId)) continue;
			if ("conflicts" in e) conflicted.push(e);
			else empty.push(e.changeId);
		}
		const applied = new Set(a.stack.entries.filter((e) => e.ok).map((e) => e.changeId));
		return { a, kept: candidates.filter((id) => applied.has(id)) };
	};

	// `segment` is known to fail on top of `accepted` (with evidence `failing`).
	const resolve = async (segment: string[], failing: Attempt): Promise<void> => {
		if (segment.length === 0) return;
		if (segment.length === 1) {
			culprits.push({ changeId: segment[0], evidence: failing.evidence });
			return;
		}
		const mid = Math.ceil(segment.length / 2);
		for (const half of [segment.slice(0, mid), segment.slice(mid)]) {
			const { a, kept } = await run(half);
			if (kept.length === 0) continue;
			if (evidenceOk(a.evidence)) {
				accepted = [...accepted, ...kept];
				verified = a;
			} else {
				await resolve(kept, a);
			}
		}
	};

	const { a: first, kept } = await run(changeIds);
	if (evidenceOk(first.evidence)) {
		accepted = kept;
		verified = kept.length ? first : null;
	} else {
		// Before blaming anyone, check trunk on its own. If it's already red, every change would look guilty.
		const baseline = await attempt(`#${++n} baseline`, []);
		if (!evidenceOk(baseline.evidence)) {
			return { attempt: null, land: [], conflicted, empty, culprits: [], requeue: kept, trunkRed: { commit: baseline.stack.trunk, evidence: baseline.evidence } };
		}
		await resolve(kept, first);
	}
	return { attempt: accepted.length ? verified : null, land: accepted, conflicted, empty, culprits, requeue: [], trunkRed: null };
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
