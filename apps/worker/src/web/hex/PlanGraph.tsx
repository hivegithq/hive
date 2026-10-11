import { motion } from "motion/react";
import type { Goal } from "../../domain/types.ts";
import { hexPoints } from "./geometry.ts";

// A planned goal's sub-goals as a dependency graph: columns by depth (everything in a column can
// run at once; a column waits for the ones before it), one hex per sub-goal in its status colour.

const LOOK: Record<string, { fill: string; stroke: string; pulse?: boolean; label: string }> = {
	open: { fill: "rgba(125,141,161,0.10)", stroke: "rgba(160,178,200,0.6)", label: "waiting" },
	in_progress: { fill: "rgba(246,130,31,0.45)", stroke: "#f6821f", pulse: true, label: "agent working" },
	racing: { fill: "rgba(246,130,31,0.45)", stroke: "#f6821f", pulse: true, label: "racing" },
	achieved: { fill: "rgba(251,173,65,0.9)", stroke: "#fbad41", label: "landed" },
	abandoned: { fill: "transparent", stroke: "#3a3a40", label: "abandoned" },
};

const COL = 210;
const ROW = 92;
const R = 22;
const MAX_ROWS = 4;

export function PlanGraph({ goals, deps, className, onSelect }: { goals: Goal[]; deps: [string, string][]; className?: string; onSelect?: (goalId: string) => void }) {
	const ids = new Set(goals.map((g) => g.id));
	const edges = deps.filter(([a, b]) => ids.has(a) && ids.has(b));
	const parents = new Map<string, string[]>();
	for (const [g, d] of edges) parents.set(g, [...(parents.get(g) ?? []), d]);

	// Depth: the longest chain of dependencies before a sub-goal can start.
	const depth = new Map<string, number>();
	const depthOf = (id: string, seen = new Set<string>()): number => {
		if (depth.has(id)) return depth.get(id)!;
		if (seen.has(id)) return 0;
		seen.add(id);
		const d = Math.max(-1, ...(parents.get(id) ?? []).map((p) => depthOf(p, seen))) + 1;
		depth.set(id, d);
		return d;
	};
	const columns: Goal[][] = [];
	for (const g of goals) (columns[depthOf(g.id)] ??= []).push(g);

	// A wide stage (many sub-goals that can run at once) wraps into columns of at most MAX_ROWS.
	const pos = new Map<string, { x: number; y: number }>();
	const tallest = Math.min(MAX_ROWS, Math.max(1, ...columns.map((c) => c.length)));
	let x = 40;
	for (const col of columns.filter(Boolean)) {
		const stacks = Math.ceil(col.length / MAX_ROWS);
		col.forEach((g, i) => {
			const stack = Math.floor(i / MAX_ROWS);
			const inStack = Math.min(MAX_ROWS, col.length - stack * MAX_ROWS);
			const row = i % MAX_ROWS;
			pos.set(g.id, { x: x + stack * COL, y: 40 + (row + (tallest - inStack) / 2) * ROW });
		});
		x += stacks * COL + 40;
	}
	const width = x - 40 + COL - 20;
	const height = 40 + (tallest - 1) * ROW + 60;

	return (
		<div className={`overflow-x-auto ${className ?? ""}`}>
			<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${goals.length} sub-goals in ${columns.length} stages`}>
				{edges.map(([g, d]) => {
					const a = pos.get(d)!;
					const b = pos.get(g)!;
					const mx = (a.x + b.x) / 2;
					return (
						<motion.path
							key={`${d}-${g}`}
							d={`M ${a.x + R} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - R} ${b.y}`}
							fill="none"
							stroke="rgba(251,173,65,0.35)"
							strokeWidth="1.5"
							initial={{ pathLength: 0 }}
							animate={{ pathLength: 1 }}
							transition={{ duration: 0.8 }}
						/>
					);
				})}
				{goals.map((g) => {
					const p = pos.get(g.id)!;
					const look = LOOK[g.status] ?? LOOK.open;
					return (
						<g
							key={g.id}
							{...(onSelect && {
								role: "button",
								tabIndex: 0,
								"aria-label": `${g.title}: ${look.label}`,
								onClick: () => onSelect(g.id),
								onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(g.id)),
								className: "cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[3] [&:hover>polygon]:stroke-[2.5]",
							})}
						>
							<title>{`${g.title}: ${look.label}`}</title>
							<motion.polygon
								points={hexPoints(p.x, p.y, R)}
								initial={false}
								animate={{ fill: look.fill, stroke: look.stroke, opacity: look.pulse ? [1, 0.55, 1] : 1 }}
								transition={look.pulse ? { opacity: { repeat: Number.POSITIVE_INFINITY, duration: 1.6 }, default: { duration: 0.4 } } : { duration: 0.4 }}
								strokeWidth="1.5"
							/>
							<foreignObject x={p.x + R + 8} y={p.y - 22} width={COL - R - 22} height="46">
								<p className="line-clamp-2 text-[12px] leading-snug text-kumo-default">{g.title}</p>
							</foreignObject>
						</g>
					);
				})}
			</svg>
		</div>
	);
}

export const PLAN_LEGEND = Object.entries(LOOK)
	.filter(([k]) => ["open", "in_progress", "achieved"].includes(k))
	.map(([, v]) => v);
