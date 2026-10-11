import { Button } from "@cloudflare/kumo/components/button";
import { ArrowCounterClockwiseIcon, DiceFiveIcon, PlayIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Attempt, findLandable } from "../../landing/batch.ts";
import { hexPoints, prefersReducedMotion } from "../hex/geometry.ts";

// The real culprit search (landing/batch.ts, the code production runs) driven by a fake stack:
// a change "applies" always, and the stack's tests fail if it contains a broken change.

const N = 16;
const ids = Array.from({ length: N }, (_, i) => `c${i}`);

interface Run {
	label: string;
	stack: string[]; // what was on trunk for this run
	fresh: string[]; // the changes being tried
	ok: boolean;
	baseline: boolean;
}

function plan(broken: Set<string>) {
	const runs: Run[] = [];
	const attempt = async (label: string, more: string[], onto: Attempt | null): Promise<Attempt> => {
		const prior = onto ? onto.stack.entries.filter((e) => e.ok).map((e) => e.changeId) : [];
		const stack = [...prior, ...more];
		const ok = !stack.some((id) => broken.has(id));
		runs.push({ label, stack, fresh: more, ok, baseline: label.includes("baseline") });
		return {
			stack: { trunk: "t", tip: "t", entries: stack.map((changeId) => ({ changeId, ok: true as const, prev: "", tip: "", files: [] })) },
			evidence: [{ kind: "test", command: "npm test", ok, output: "" }],
		};
	};
	return findLandable(attempt, ids).then((outcome) => ({ runs, outcome }));
}

type Look = "idle" | "testing" | "landed" | "culprit" | "broken";

const LOOK: Record<Look, { fill: string; stroke: string }> = {
	idle: { fill: "rgba(125,141,161,0.08)", stroke: "rgba(160,178,200,0.45)" },
	broken: { fill: "rgba(125,141,161,0.08)", stroke: "rgba(240,96,93,0.9)" },
	testing: { fill: "rgba(246,130,31,0.35)", stroke: "#f6821f" },
	landed: { fill: "rgba(251,173,65,0.85)", stroke: "#fbad41" },
	culprit: { fill: "rgba(240,96,93,0.75)", stroke: "#f0605d" },
};

export function BatchDemo() {
	const [broken, setBroken] = useState<Set<string>>(() => new Set(["c11"]));
	const [runs, setRuns] = useState<Run[]>([]);
	const [shown, setShown] = useState(0); // how many runs have played
	const [result, setResult] = useState<{ land: string[]; culprits: string[] } | null>(null);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	const playing = runs.length > 0 && shown < runs.length;
	const done = runs.length > 0 && shown >= runs.length;

	useEffect(() => () => clearInterval(timer.current ?? undefined), []);

	const reset = () => {
		clearInterval(timer.current ?? undefined);
		setRuns([]);
		setShown(0);
		setResult(null);
	};

	const run = async () => {
		reset();
		const { runs: r, outcome } = await plan(broken);
		setRuns(r);
		setResult({ land: outcome.land, culprits: outcome.culprits.map((c) => c.changeId) });
		if (prefersReducedMotion()) return setShown(r.length);
		setShown(1);
		timer.current = setInterval(() => {
			setShown((s) => {
				if (s + 1 >= r.length) clearInterval(timer.current ?? undefined);
				return Math.min(s + 1, r.length);
			});
		}, 850);
	};

	const toggle = (id: string) => {
		if (playing) return;
		reset();
		setBroken((b) => {
			const next = new Set(b);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const randomize = () => {
		reset();
		const k = 1 + Math.floor(Math.random() * 3);
		setBroken(new Set([...ids].sort(() => Math.random() - 0.5).slice(0, k)));
	};

	const current = shown > 0 ? runs[shown - 1] : null;
	// Changes known good so far: everything on the stack of a run that passed.
	const accepted = useMemo(() => {
		const s = new Set<string>();
		for (const r of runs.slice(0, shown)) if (r.ok) for (const id of r.stack) s.add(id);
		return s;
	}, [runs, shown]);

	const look = (id: string): Look => {
		if (done && result) return result.culprits.includes(id) ? "culprit" : "landed";
		if (current?.fresh.includes(id)) return "testing";
		if (accepted.has(id)) return "landed";
		return broken.has(id) ? "broken" : "idle";
	};

	const size = 26;
	const gap = size * Math.sqrt(3) + 4;
	const width = gap * (N / 2) + gap / 2 + 8;

	return (
		<div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
			<div className="cut relative bg-comb/60 p-5 ring-1 ring-comb-line sm:p-8">
				<p className="mb-4 text-sm text-kumo-subtle">
					Sixteen changes in one batch. Click a cell to break it (its tests will fail), then run the batch.
				</p>
				<svg viewBox={`0 0 ${width} ${size * 4 + 10}`} className="w-full" role="group" aria-label="Changes in the batch">
					{ids.map((id, i) => {
						const row = i < N / 2 ? 0 : 1;
						const col = i % (N / 2);
						const x = 4 + gap / 2 + col * gap + (row ? gap / 2 : 0);
						const y = size + 4 + row * size * 1.6;
						const l = LOOK[look(id)];
						return (
							<g
								key={id}
								role="button"
								tabIndex={0}
								aria-pressed={broken.has(id)}
								aria-label={`Change ${i + 1}${broken.has(id) ? ", broken" : ""}`}
								onClick={() => toggle(id)}
								onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(id))}
								className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[3]"
							>
								<motion.polygon
									points={hexPoints(x, y, size)}
									animate={{ fill: l.fill, stroke: l.stroke }}
									transition={{ duration: 0.35 }}
									strokeWidth={broken.has(id) && look(id) !== "culprit" ? 2.5 : 1.5}
									strokeDasharray={look(id) === "broken" ? "5 4" : undefined}
								/>
								<text
									x={x}
									y={y + 4}
									textAnchor="middle"
									className={`pointer-events-none font-mono text-[11px] ${["landed", "testing", "culprit"].includes(look(id)) ? "fill-night" : "fill-wax"}`}
								>
									{i + 1}
								</text>
							</g>
						);
					})}
				</svg>
				<div className="mt-6 flex flex-wrap gap-2">
					<Button variant="primary" icon={PlayIcon} onClick={run} disabled={playing || broken.size === N}>
						Run the batch
					</Button>
					<Button variant="secondary" icon={DiceFiveIcon} onClick={randomize} disabled={playing}>
						Break random changes
					</Button>
					<Button variant="ghost" icon={ArrowCounterClockwiseIcon} onClick={reset} disabled={runs.length === 0}>
						Reset
					</Button>
				</div>
			</div>

			<div aria-live="polite" className="space-y-5">
				<ol className="space-y-2 font-mono text-sm">
					{runs.slice(0, shown).map((r, i) => (
						<motion.li
							key={`${r.label}-${i}`}
							initial={{ opacity: 0, x: -8 }}
							animate={{ opacity: 1, x: 0 }}
							className="flex items-baseline gap-3"
						>
							<span className="w-12 shrink-0 text-kumo-subtle">run {i + 1}</span>
							<span className="text-kumo-default">{describe(r)}</span>
							<span className={r.ok ? "ml-auto text-honey" : "ml-auto text-alarm"}>{r.ok ? "pass" : "fail"}</span>
						</motion.li>
					))}
					{runs.length === 0 && <li className="text-kumo-subtle">Waiting for a batch.</li>}
				</ol>
				{done && result && (
					<motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="cut-sm bg-honey/10 p-4 ring-1 ring-honey/40">
						<p className="font-display text-xl text-wax">
							{result.land.length} landed, {result.culprits.length} sent back, in {runs.length} test runs.
						</p>
						<p className="mt-1 text-sm text-kumo-subtle">
							Testing each change on its own would take {N} runs, one after another. With k broken changes in n, this search costs about k·log₂n extra runs, and every good change in the batch still lands.
						</p>
					</motion.div>
				)}
			</div>
		</div>
	);
}

function describe(r: Run) {
	if (r.baseline) return "trunk on its own";
	const range = (xs: string[]) => {
		const n = xs.map((x) => Number(x.slice(1)) + 1).sort((a, b) => a - b);
		return n.length === 1 ? `change ${n[0]}` : `changes ${n[0]}–${n.at(-1)}`;
	};
	const kept = r.stack.length - r.fresh.length;
	return kept ? `${range(r.fresh)} on top of ${kept} that passed` : r.fresh.length === N ? `all ${N} on trunk` : range(r.fresh);
}
