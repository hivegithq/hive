import { describe, expect, it } from "vitest";
import { type Attempt, type AttemptFn, findLandable, selectBatch } from "./batch.ts";

// A fake stack: every change applies except `conflicting`; evidence fails if the stack contains `broken`.
function fakeAttempt(opts: { conflicting?: string[]; broken?: string[] }) {
	const labels: string[] = [];
	const fn: AttemptFn = async (label, ids) => {
		labels.push(label);
		const entries = ids.map((changeId) =>
			opts.conflicting?.includes(changeId)
				? { changeId, ok: false as const, conflicts: [{ path: "x.ts", excerpt: "<<<<<<<" }] }
				: { changeId, ok: true as const, prev: "p", tip: `t-${changeId}`, files: [] },
		);
		const applied = entries.filter((e) => e.ok).map((e) => e.changeId);
		const ok = !applied.some((id) => opts.broken?.includes(id));
		const attempt: Attempt = { stack: { trunk: "t0", tip: "tip", entries }, evidence: [{ kind: "test", command: "npm test", ok, output: ok ? "" : "fail" }] };
		return attempt;
	};
	return { fn, labels };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe("findLandable", () => {
	it("lands the whole batch with one evidence run when it passes", async () => {
		const { fn, labels } = fakeAttempt({});
		const r = await findLandable(fn, ids(32));
		expect(r.land).toHaveLength(32);
		expect(labels).toEqual(["all"]);
	});

	it("drops conflicting changes and lands the rest", async () => {
		const r = await findLandable(fakeAttempt({ conflicting: ["c3"] }).fn, ids(8));
		expect(r.conflicted.map((c) => c.changeId)).toEqual(["c3"]);
		expect(r.land).toHaveLength(7);
	});

	it("halves to a passing prefix and requeues the rest", async () => {
		const { fn, labels } = fakeAttempt({ broken: ["c5"] });
		const r = await findLandable(fn, ids(8));
		expect(r.land).toEqual(["c0", "c1", "c2", "c3"]);
		expect(r.requeue).toEqual(["c4", "c5", "c6", "c7"]);
		expect(labels).toEqual(["all", "first 4"]);
	});

	it("isolates a culprit at the front", async () => {
		const r = await findLandable(fakeAttempt({ broken: ["c0"] }).fn, ids(8));
		expect(r.land).toEqual([]);
		expect(r.culprit?.changeId).toBe("c0");
		expect(r.requeue).toHaveLength(7);
	});

	it("always makes progress: something lands or a culprit is named", async () => {
		for (let bad = 0; bad < 16; bad++) {
			const r = await findLandable(fakeAttempt({ broken: [`c${bad}`] }).fn, ids(16));
			expect(r.land.length > 0 || r.culprit !== null).toBe(true);
			expect(r.land).not.toContain(`c${bad}`);
		}
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
