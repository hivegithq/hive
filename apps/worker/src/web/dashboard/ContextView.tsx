import { useEffect, useState } from "react";
import { api, type ContextBreakdown } from "../api.ts";

const PARTS: { key: keyof ContextBreakdown["steps"][number]["tokens"]; label: string; color: string; note: string }[] = [
	{ key: "system", label: "Instructions", color: "bg-steel", note: "the system prompt, sent with every step" },
	{ key: "briefing", label: "Briefing", color: "bg-flare/70", note: "the goal, guidance and messages from people" },
	{ key: "reasoning", label: "Thinking", color: "bg-white/40", note: "the model's own reasoning and replies" },
	{ key: "calls", label: "Tool calls", color: "bg-honey/60", note: "what it asked tools to do" },
	{ key: "results", label: "Tool results", color: "bg-honey", note: "what the tools sent back: files read, command output" },
];

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Where an agent's context window went. Everything in it is read again on every step, so a large
// tool result early on is paid for many times over.
export function ContextView({ repo, changeId, tick }: { repo: string; changeId: string; tick: number }) {
	const [b, setB] = useState<ContextBreakdown | null | "none">(null);
	useEffect(() => {
		api.context(repo, changeId).then(setB, () => setB("none"));
	}, [repo, changeId, tick]);
	if (b === null || b === "none" || b.steps.length === 0) return null;
	const last = b.steps.at(-1)!;
	const max = Math.max(...b.steps.map((s) => s.total), 1);
	return (
		<div>
			<p className="mb-3 text-sm text-kumo-subtle">
				About <span className="tabular text-wax">{k(last.total)}</span> tokens by step {last.step}, re-read on every step. Estimated from the transcript.
			</p>
			<div className="flex h-2 overflow-hidden bg-white/5" role="img" aria-label="Context by kind">
				{PARTS.map((p) => (
					<div key={p.key} className={p.color} style={{ width: `${(last.tokens[p.key] / Math.max(last.total, 1)) * 100}%` }} title={`${p.label}: ${k(last.tokens[p.key])}`} />
				))}
			</div>
			<ul className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
				{PARTS.map((p) => (
					<li key={p.key} className="flex items-center gap-2" title={p.note}>
						<span className={`h-2 w-2 shrink-0 ${p.color}`} />
						<span className="text-kumo-subtle">{p.label}</span>
						<span className="ml-auto tabular text-kumo-default">{k(last.tokens[p.key])}</span>
					</li>
				))}
			</ul>
			{last.step > 1 && (
				<div className="mt-4 flex h-10 items-end gap-px" aria-label="Context size per step">
					{b.steps.map((s) => (
						<div key={s.step} className="min-w-[3px] flex-1 bg-honey/50" style={{ height: `${Math.max(6, (s.total / max) * 100)}%` }} title={`step ${s.step}: ${k(s.total)}`} />
					))}
				</div>
			)}
			{b.biggest[0] && b.biggest[0].tokens > 800 && (
				<p className="mt-3 text-xs text-kumo-subtle">
					Largest tool result: <span className="text-kumo-default">{b.biggest[0].tool}</span> at step {b.biggest[0].step}, about {k(b.biggest[0].tokens)} tokens, read again on every step after.
				</p>
			)}
		</div>
	);
}
