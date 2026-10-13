import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { QuestionIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { api, modelLabel, type Why } from "../api.ts";

// "Why is this line here?": from any line of trunk to the change that wrote it, the goal it served,
// what the agent said it would do, the proof, and who decided.
export function WhyLine({ repo, onSelect }: { repo: string; onSelect: (changeId: string) => void }) {
	const [open, setOpen] = useState(false);
	const [where, setWhere] = useState("");
	const [busy, setBusy] = useState(false);
	const [why, setWhy] = useState<Why | null>(null);
	const [error, setError] = useState<string | null>(null);

	const ask = async (e: FormEvent) => {
		e.preventDefault();
		const m = /^(.+?):(\d+)$/.exec(where.trim());
		if (!m) return setError("Write it as path:line, like src/cart.ts:42");
		setBusy(true);
		setError(null);
		try {
			setWhy(await api.why(repo, m[1], Number(m[2])));
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	if (!open)
		return (
			<button type="button" onClick={() => setOpen(true)} className="mb-4 flex items-center gap-2 text-sm text-kumo-subtle hover:text-honey">
				<QuestionIcon size={14} /> Why is this line here?
			</button>
		);
	return (
		<div className="mb-5 space-y-3">
			<form onSubmit={ask} className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Input label="Why is this line here?" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="src/cart.ts:42" />
				</div>
				<Button type="submit" size="sm" variant="secondary" loading={busy}>
					Trace
				</Button>
			</form>
			{busy && <p className="text-xs text-kumo-subtle">Reading trunk's history (a few seconds the first time).</p>}
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
			{why && !why.found && <p className="text-sm text-kumo-subtle">No such line on trunk.</p>}
			{why?.found && (
				<div className="cut-sm space-y-2 bg-black/30 p-3 text-sm ring-1 ring-white/10">
					<code className="block truncate font-mono text-xs text-wax">{why.text}</code>
					{why.hive ? (
						<>
							<p className="text-kumo-default">
								Landed by Hive for <span className="text-wax">{why.hive.goal?.title ?? "a goal"}</span>
								{why.hive.issue && (
									<>
										{" "}
										(
										<a href={why.hive.issue.url} target="_blank" rel="noreferrer" className="text-steel hover:text-honey">
											{why.hive.issue.ref}
										</a>
										)
									</>
								)}
								, written by {modelLabel(why.hive.model)}.
							</p>
							{why.hive.intent && <p className="text-kumo-subtle">Intent: {why.hive.intent.summary}</p>}
							{why.hive.evidence.length > 0 && (
								<p className="text-xs text-kumo-subtle">
									Proof: {why.hive.evidence.map((e) => `${e.ok ? "✓" : "✗"} ${e.kind}`).join(", ")}
								</p>
							)}
							{why.hive.decision && (
								<p className="text-xs text-kumo-subtle">
									{why.hive.decision.decidedBy}: {why.hive.decision.rationale}
								</p>
							)}
							<button type="button" onClick={() => why.hive && onSelect(why.hive.changeId)} className="text-xs text-honey hover:underline">
								Open {why.hive.changeId}
							</button>
						</>
					) : (
						<p className="text-kumo-subtle">
							From outside Hive: “{why.subject}” by {why.author}, {why.commit.slice(0, 8)}.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
