import type { Change, Goal, Intent, Overlap } from "../domain/types.ts";
import { modelLabel } from "./api.ts";

const LEVEL_LABEL: Record<Overlap["level"], string> = {
	structural: "same symbol",
	referential: "calls into",
	textual: "same file",
};

export function Strip(props: {
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
		<button
			type="button"
			className={`strip strip--${change.status}${props.selected ? " strip--selected" : ""}`}
			onClick={props.onSelect}
			aria-pressed={props.selected}
		>
			<span className="strip__edge" aria-hidden="true">
				{overlaps.map((o) => (
					<span key={o.otherIntentId} className={`notch notch--${o.level}`} />
				))}
			</span>
			<span className="strip__body">
				<span className="strip__head">
					<span className="strip__callsign">{change.id}</span>
					<span className="strip__model">{modelLabel(change.model)}</span>
					{props.queuePosition !== null && <span className="strip__slot">#{props.queuePosition + 1} to land</span>}
				</span>
				<span className="strip__goal">{goal?.title ?? change.goalId}</span>
				{intent ? <span className="strip__intent">{intent.summary}</span> : <span className="strip__intent strip__intent--pending">Exploring the code</span>}
				{strongest && (
					<span className={`strip__overlap overlap--${strongest.level}`}>
						{LEVEL_LABEL[strongest.level]} as {props.agentLabel(strongest.otherAgentId)}
						{overlaps.length > 1 && `, +${overlaps.length - 1} more`}
					</span>
				)}
				<span className="strip__foot">
					{change.race && <span>Race lane {change.race.index + 1}</span>}
					{change.attempts > 1 && <span>attempt {change.attempts}</span>}
					{change.status === "bounced" && <span className="strip__flag">sent back</span>}
					{change.race?.won && <span className="strip__flag strip__flag--won">won race</span>}
				</span>
			</span>
		</button>
	);
}
