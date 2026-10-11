import { describe, expect, it } from "vitest";
import { type Attempt, type AttemptFn, findLandable, selectBatch } from "./batch.ts";

// A fake stack: every change applies except `conflicting`; evidence fails if the stack contains `broken`.
function fakeAttempt(opts: { conflicting?: string[]; broken?: string[]; redTrunk?: boolean }) {
	const labels: string[] = [];
	const picks: number[] = []; // cherry-picks per attempt
	const fn: AttemptFn = async (label, more, onto) => {
		labels.push(label);
		picks.push(more.length);
		const ids = [...(onto ? onto.stack.entries.filter((e) => e.ok).map((e) => e.changeId) : []), ...more];
		const entries = ids.map((changeId) =>
			opts.conflicting?.includes(changeId)
				? { changeId, ok: false as const, conflicts: [{ path: "x.ts", excerpt: "<<<<<<<" }] }
				: { changeId, ok: true as const, prev: "p", tip: `t-${changeId}`, files: [] },
		);
		const applied = entries.filter((e) => e.ok).map((e) => e.changeId);
		const ok = !opts.redTrunk && !applied.some((id) => opts.broken?.includes(id));
		const attempt: Attempt = { stack: { trunk: "t0", tip: "tip", entries }, evidence: [{ kind: "test", command: "npm test", ok, output: ok ? "" : "fail" }] };
		return attempt;
	};
	return { fn, labels, picks };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe("findLandable", () => {
	it("lands the whole batch with one verification when it passes", async () => {
		const { fn, labels } = fakeAttempt({});
		const r = await findLandable(fn, ids(32));
		expect(r.land).toHaveLength(32);
		expect(labels).toHaveLength(1);
	});

	it("drops conflicting changes and lands the rest", async () => {
		const r = await findLandable(fakeAttempt({ conflicting: ["c3"] }).fn, ids(8));
		expect(r.conflicted.map((c) => c.changeId)).toEqual(["c3"]);
		expect(r.land).toHaveLength(7);
	});

	it("isolates one culprit and lands everything else in the same batch", async () => {
		const { fn, labels } = fakeAttempt({ broken: ["c5"] });
		const r = await findLandable(fn, ids(64));
		expect(r.culprits.map((c) => c.changeId)).toEqual(["c5"]);
		expect(r.land).toHaveLength(63);
		expect(r.land).not.toContain("c5");
		expect(labels.length).toBeLessThanOrEqual(2 + 2 * Math.log2(64)); // batch, trunk baseline, halving
	});

	it("isolates several culprits", async () => {
		const broken = ["c0", "c17", "c40", "c63"];
		const r = await findLandable(fakeAttempt({ broken }).fn, ids(64));
		expect(r.culprits.map((c) => c.changeId).sort()).toEqual([...broken].sort());
		expect(r.land).toHaveLength(60);
	});

	it("the verified attempt is exactly the landed set", async () => {
		const r = await findLandable(fakeAttempt({ broken: ["c2", "c9"] }).fn, ids(16));
		const stacked = r.attempt!.stack.entries.filter((e) => e.ok).map((e) => e.changeId);
		expect(stacked).toEqual(r.land);
	});

	it("builds on verified stacks instead of re-picking them", async () => {
		const { fn, picks } = fakeAttempt({ broken: ["c100"] });
		const r = await findLandable(fn, ids(128));
		expect(r.land).toHaveLength(127);
		// Re-stacking from trunk every time would cost ~128 picks per attempt; halving costs ~2n in total.
		expect(picks.reduce((a, b) => a + b, 0)).toBeLessThan(3 * 128);
	});

	it("every culprit position is found, every good change lands", async () => {
		for (let bad = 0; bad < 16; bad++) {
			const r = await findLandable(fakeAttempt({ broken: [`c${bad}`] }).fn, ids(16));
			expect(r.culprits.map((c) => c.changeId)).toEqual([`c${bad}`]);
			expect(r.land).toHaveLength(15);
		}
	});
});

describe("findLandable on a red trunk", () => {
	it("blames no one and puts everything back when trunk itself fails", async () => {
		const { fn, labels } = fakeAttempt({ redTrunk: true });
		const r = await findLandable(fn, ids(64));
		expect(r.trunkRed).not.toBeNull();
		expect(r.culprits).toEqual([]);
		expect(r.land).toEqual([]);
		expect(r.requeue).toHaveLength(64);
		expect(labels).toHaveLength(2); // the batch, then trunk alone
	});
});

describe("selectBatch", () => {
	it("takes disjoint changes first, then fills in order, up to max", () => {
		const q = [
			{ changeId: "a", paths: ["cart.ts"] },
			{ changeId: "b", paths: ["cart.ts"] },
			{ changeId: "c", paths: ["price.ts"] },
			{ changeId: "d", paths: ["docs.md"] },
		];
		expect(selectBatch(q, 3)).toEqual(["a", "c", "d"]);
		expect(selectBatch(q, 10)).toEqual(["a", "c", "d", "b"]);
	});
});
