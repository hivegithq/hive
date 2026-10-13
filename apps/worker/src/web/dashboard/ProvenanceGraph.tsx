import { usd } from "../../domain/pricing.ts";
import type { GoalHistory } from "../api.ts";
import { modelLabel } from "../api.ts";

// How each goal became code, drawn: the goal, every attempt at it (a later attempt follows the one
// before it), how each attempt ended, and the pull request it became. Click an attempt for its
// evidence and decision.

const ROW = 38;
const GOAL_X = 8;
const ATT_X = 250;
const OUT_X = 500;
const PR_X = 650;
const W = 780;

const OUTCOME: Record<string, { text: string; fill: string }> = {
	land: { text: "landed", fill: "fill-honey" },
	win: { text: "won the race", fill: "fill-honey" },
	bounce: { text: "sent back", fill: "fill-alarm/70" },
	lose: { text: "lost the race", fill: "fill-white/25" },
	escalate: { text: "needs a person", fill: "fill-alarm" },
};

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const who = (m: string) => (m === "sim" ? "simulated" : m === "external" ? "an external agent" : modelLabel(m));

function Goal({ h, y0, onSelect }: { h: GoalHistory; y0: number; onSelect: (id: string) => void }) {
	const attempts = h.attempts.slice(-8);
	const rows = Math.max(1, attempts.length);
	const mid = y0 + (rows * ROW) / 2;
	return (
		<g>
			<rect x={GOAL_X} y={mid - 24} width={200} height={48} rx={4} className="fill-white/[0.04] stroke-white/20" />
			<text x={GOAL_X + 10} y={mid - 6} className="fill-wax text-[12px] font-medium">
				{short(h.goal.title, 28)}
			</text>
			<text x={GOAL_X + 10} y={mid + 12} className="fill-steel text-[10px]">
				{h.goal.status.replace("_", " ")}
				{h.subgoals.length > 0 ? ` · ${h.subgoals.length} sub-goals` : ""}
				{h.cost >= 0.01 ? ` · ${usd(h.cost)}` : ""}
			</text>
			{attempts.map((a, i) => {
				const y = y0 + i * ROW + ROW / 2;
				const end = [...a.steps].reverse().find((s) => OUTCOME[s.kind]);
				const o = end ? OUTCOME[end.kind] : null;
				const landed = end?.kind === "land" || end?.kind === "win";
				return (
					<g key={a.changeId}>
						<path d={`M${GOAL_X + 200} ${mid} C ${GOAL_X + 235} ${mid}, ${ATT_X - 35} ${y}, ${ATT_X} ${y}`} className="fill-none stroke-white/20" />
						{i > 0 && <path d={`M${ATT_X + 6} ${y - ROW + 10} L${ATT_X + 6} ${y - 10}`} className="stroke-white/20" strokeDasharray="3 3" />}
						<g role="button" tabIndex={0} className="cursor-pointer outline-none" onClick={() => onSelect(a.changeId)} onKeyDown={(e) => e.key === "Enter" && onSelect(a.changeId)}>
							<title>{`${who(a.model)}: ${o?.text ?? "working"}${end?.text ? ` — ${end.text}` : ""}`}</title>
							<rect x={ATT_X} y={y - 14} width={190} height={28} rx={14} className="fill-white/[0.04] stroke-white/20 hover:stroke-honey" />
							<circle cx={ATT_X + 14} cy={y} r={4} className={o ? o.fill : "fill-steel"} />
							<text x={ATT_X + 26} y={y + 4} className="fill-kumo-default text-[11px]">
								{short(who(a.model), 24)}
							</text>
						</g>
						<path d={`M${ATT_X + 190} ${y} L${OUT_X} ${y}`} className="stroke-white/20" />
						<text x={OUT_X + 8} y={y + 4} className={`${o ? o.fill : "fill-steel"} text-[11px]`}>
							{o ? o.text : "working"}
						</text>
						{landed && h.pr && <path d={`M${OUT_X + 100} ${y} L${PR_X} ${y}`} className="stroke-honey/50" />}
					</g>
				);
			})}
			{h.pr && (
				<a href={h.pr.url} target="_blank" rel="noreferrer">
					<rect x={PR_X} y={mid - 14} width={110} height={28} rx={14} className="fill-honey/10 stroke-honey/60" />
					<text x={PR_X + 55} y={mid + 4} textAnchor="middle" className="fill-honey text-[11px]">
						pull request #{h.pr.number}
					</text>
				</a>
			)}
		</g>
	);
}

export function ProvenanceGraph({ history, onSelect }: { history: GoalHistory[]; onSelect: (id: string) => void }) {
	let y = 8;
	const blocks = history.map((h) => {
		const y0 = y;
		y += Math.max(1, Math.min(8, h.attempts.length)) * ROW + 22;
		return { h, y0 };
	});
	return (
		<div className="mt-5 overflow-x-auto">
			<svg viewBox={`0 0 ${W} ${y}`} width={W} height={y} role="img" aria-label="Goals, the attempts at them, and how each ended" className="max-w-none font-sans">
				{blocks.map(({ h, y0 }) => (
					<Goal key={h.goal.id} h={h} y0={y0} onSelect={onSelect} />
				))}
			</svg>
		</div>
	);
}
