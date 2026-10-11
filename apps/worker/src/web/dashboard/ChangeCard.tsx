import { Badge } from "@cloudflare/kumo/components/badge";
import { motion } from "motion/react";
import type { Change, ChangeStatus, Goal, Intent, Overlap } from "../../domain/types.ts";
import { modelLabel } from "../api.ts";
import { hexPoints } from "../hex/geometry.ts";

const LEVEL_LABEL: Record<Overlap["level"], string> = {
	structural: "same symbol",
	referential: "calls into",
	textual: "same file",
};

const LEVEL_COLOR: Record<Overlap["level"], string> = {
	structural: "#f6821f",
	referential: "#f0605d",
	textual: "#7d8da1",
};

// The status cell in a card's corner uses the Hive map's colours.
export const STATUS_LOOK: Record<ChangeStatus, { fill: string; stroke: string; pulse?: boolean }> = {
	drafting: { fill: "rgba(125,141,161,0.15)", stroke: "#7d8da1" },
	bounced: { fill: "rgba(125,141,161,0.15)", stroke: "#f0605d" },
	submitted: { fill: "rgba(246,130,31,0.12)", stroke: "#f6821f" },
	evaluated: { fill: "rgba(246,130,31,0.12)", stroke: "#f6821f" },
	converging: { fill: "rgba(246,130,31,0.55)", stroke: "#f6821f", pulse: true },
	escalated: { fill: "rgba(240,96,93,0.6)", stroke: "#f0605d" },
	landed: { fill: "rgba(251,173,65,0.85)", stroke: "#fbad41" },
	archived: { fill: "transparent", stroke: "#3a3a40" },
};

export function StatusHex({ status, size = 9 }: { status: ChangeStatus; size?: number }) {
	const look = STATUS_LOOK[status];
	return (
		<svg width={size * 2} height={size * 2.2} viewBox={`0 0 ${size * 2} ${size * 2.2}`} className={look.pulse ? "animate-pulse-flare" : undefined} aria-hidden="true">
			<polygon points={hexPoints(size, size * 1.1, size - 0.8)} fill={look.fill} stroke={look.stroke} strokeWidth="1.4" />
		</svg>
	);
}

export function ChangeCard(props: {
	change: Change;
	goal: Goal | undefined;
	intent: Intent | undefined;
	overlaps: Overlap[];
	queuePosition: number | null;
	agentLabel: (agentId: string) => string;
	selected: boolean;
	onSelect: () => void;
}) {
	const { change, goal, intent, overlaps } = props;
	const strongest = overlaps.find((o) => o.level === "structural") ?? overlaps.find((o) => o.level === "referential") ?? overlaps[0];
	return (
		<motion.button
			layout="position"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, scale: 0.96 }}
			transition={{ duration: 0.25 }}
			type="button"
			onClick={props.onSelect}
			aria-pressed={props.selected}
			className={`cut-sm group relative w-full p-4 text-left ring-1 transition-colors ${
				props.selected ? "bg-honey/[0.08] ring-honey/60" : "bg-[#141417] ring-comb-line hover:bg-[#19191d] hover:ring-white/15"
			}`}
		>
			<span className="flex items-center gap-2">
				<StatusHex status={change.status} />
				<span className="font-mono text-xs text-kumo-subtle">{change.id}</span>
				<Badge variant={change.model === "sim" ? "neutral" : "outline"} className="ml-auto">
					{change.model === "sim" ? "simulated" : modelLabel(change.model)}
				</Badge>
			</span>
			<span className="mt-2.5 block font-medium leading-snug text-wax">{goal?.title ?? `Goal ${change.goalId}`}</span>
			<span className={`mt-1 line-clamp-2 text-sm ${intent ? "text-kumo-subtle" : "italic text-kumo-subtle/70"}`}>
				{intent ? intent.summary : "Exploring the code before declaring an intent"}
			</span>
			{strongest && (
				<span className="mt-3 flex items-center gap-2 text-xs" style={{ color: LEVEL_COLOR[strongest.level] }}>
					<span className="flex gap-0.5" aria-hidden="true">
						{overlaps.slice(0, 5).map((o) => (
							<svg key={o.otherIntentId} width="9" height="10" viewBox="0 0 9 10">
								<polygon points={hexPoints(4.5, 5, 4.2)} fill={LEVEL_COLOR[o.level]} />
							</svg>
						))}
					</span>
					{LEVEL_LABEL[strongest.level]} as {props.agentLabel(strongest.otherAgentId)}
					{overlaps.length > 1 && `, +${overlaps.length - 1}`}
				</span>
			)}
			{(props.queuePosition !== null || change.race || change.attempts > 1 || change.status === "bounced") && (
				<span className="mt-3 flex flex-wrap gap-1.5">
					{props.queuePosition !== null && <Badge variant="orange">#{props.queuePosition + 1} to land</Badge>}
					{change.race && <Badge variant="purple">race lane {change.race.index + 1}</Badge>}
					{change.race?.won && <Badge variant="success">won race</Badge>}
					{change.attempts > 1 && <Badge variant="neutral">attempt {change.attempts}</Badge>}
					{change.status === "bounced" && <Badge variant="red">sent back</Badge>}
				</span>
			)}
		</motion.button>
	);
}
