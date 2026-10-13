import { useEffect, useRef, useState } from "react";
import { usd } from "../../domain/pricing.ts";
import { api, type GoalHistory, modelLabel } from "../api.ts";

const DOT: Record<string, string> = {
	started: "bg-steel",
	submitted: "bg-flare/70",
	land: "bg-honey",
	win: "bg-honey",
	bounce: "bg-alarm/70",
	lose: "bg-white/20",
	escalate: "bg-alarm",
};
const LABEL: Record<string, string> = { started: "started", submitted: "submitted", land: "landed", win: "won the race", bounce: "sent back", lose: "lost the race", escalate: "needs a person" };

const ago = (t: number) => {
	const m = Math.round((Date.now() - t) / 60_000);
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// What happened to each goal: every attempt, the models, how each ended, the pull request it
// became, and what it cost. Click an attempt for its evidence and decision.
export function HistoryView({ repo, tick, onSelect }: { repo: string; tick: number; onSelect: (changeId: string) => void }) {
	const [history, setHistory] = useState<GoalHistory[] | null>(null);
	const last = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is the trigger
	useEffect(() => {
		if (last.current && Date.now() - last.current < 20_000) return;
		last.current = Date.now();
		api.history(repo).then(setHistory, () => {});
	}, [repo, tick]);

	const shown = (history ?? []).filter((h) => h.attempts.length > 0).slice(0, 12);
	if (shown.length === 0) return null;
	return (
		<section className="border-t border-white/5 px-5 py-6" aria-label="History">
			<h2 className="font-display text-lg font-semibold text-wax">History of {repo}</h2>
			<p className="mt-1 text-sm text-kumo-subtle">What happened to each goal: who tried it, how each attempt ended, and what it became.</p>
			<ol className="mt-5 space-y-6">
				{shown.map((h) => (
					<li key={h.goal.id}>
						<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<p className="font-medium text-wax">{h.goal.title}</p>
							<span className="text-xs text-kumo-subtle">{h.goal.status.replace("_", " ")}</span>
							{h.subgoals.length > 0 && <span className="text-xs text-kumo-subtle">{h.subgoals.length} sub-goals</span>}
							{h.cost >= 0.01 && <span className="tabular text-xs text-kumo-subtle">{usd(h.cost)}</span>}
							{h.pr && (
								<a href={h.pr.url} target="_blank" rel="noreferrer" className="text-xs text-honey hover:underline">
									PR #{h.pr.number}
								</a>
							)}
							<span className="ml-auto text-xs text-kumo-subtle">{ago(h.at)}</span>
						</div>
						<ul className="mt-2 space-y-1.5 border-l border-white/10 pl-4">
							{h.attempts.slice(-8).map((a) => (
								<li key={a.changeId}>
									<button type="button" onClick={() => onSelect(a.changeId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm hover:text-honey">
										<span className="w-32 shrink-0 truncate text-kumo-default">{a.model === "sim" ? "simulated" : a.model === "external" ? "an external agent" : modelLabel(a.model)}</span>
										<span className="flex items-center gap-1.5">
											{a.steps
												.filter((s) => s.kind !== "started")
												.map((s, i) => (
													<span key={`${s.at}${s.kind}${i}`} className="flex items-center gap-1.5" title={s.text ? `${LABEL[s.kind] ?? s.kind}: ${s.text}` : (LABEL[s.kind] ?? s.kind)}>
														{i > 0 && <span className="h-px w-3 bg-white/15" />}
														<span className={`h-2 w-2 rounded-full ${DOT[s.kind] ?? "bg-steel"}`} />
														<span className="text-xs text-kumo-subtle">{LABEL[s.kind] ?? s.kind}</span>
													</span>
												))}
											{a.steps.every((s) => s.kind === "started") && <span className="text-xs text-kumo-subtle">working</span>}
										</span>
									</button>
								</li>
							))}
						</ul>
					</li>
				))}
			</ol>
		</section>
	);
}
