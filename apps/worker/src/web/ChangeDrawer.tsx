import { useEffect, useState } from "react";
import type { Decision } from "../domain/types.ts";
import { api, type ChangeDetail, modelLabel } from "./api.ts";

const OUTCOME_COPY: Record<Decision["outcome"], string> = {
	land: "Landed on trunk",
	bounce: "Sent back to the agent",
	escalate: "Waiting for a person",
	win: "Won the race",
	lose: "Lost the race",
};

export function ChangeDrawer(props: { repo: string; changeId: string; tick: number; onClose: () => void }) {
	const [detail, setDetail] = useState<ChangeDetail | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.change(props.repo, props.changeId).then(setDetail, (e) => setError(e.message));
	}, [props.repo, props.changeId, props.tick]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [props.onClose]);

	const act = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	if (!detail) {
		return (
			<aside className="drawer" aria-label="Change details">
				<p className="drawer__loading">{error ?? "Loading change"}</p>
			</aside>
		);
	}

	const { change, goal, intent, evidence, evaluations, decisions } = detail;
	const review = evaluations.at(-1);
	const decision = decisions.at(-1);

	return (
		<aside className="drawer" aria-label={`Change ${change.id}`}>
			<header className="drawer__header">
				<div>
					<h2 className="drawer__title">{change.id}</h2>
					<p className="drawer__sub">
						{modelLabel(change.model)} working on “{goal?.title}”
					</p>
				</div>
				<button type="button" className="icon-button" onClick={props.onClose} aria-label="Close details">
					×
				</button>
			</header>

			{change.status === "escalated" && (
				<section className="drawer__section drawer__section--ask">
					<h3>Hive needs your call</h3>
					<p>Clef wasn’t confident enough to land this on its own. Read the evidence below, then decide.</p>
					<div className="button-row">
						<button type="button" className="button button--go" disabled={busy} onClick={() => act(() => api.decide(props.repo, change.id, "land"))}>
							Land it
						</button>
						<button type="button" className="button" disabled={busy} onClick={() => act(() => api.decide(props.repo, change.id, "bounce", "Sent back from the dashboard."))}>
							Send back
						</button>
					</div>
				</section>
			)}

			{change.status === "evaluated" && change.race && (
				<section className="drawer__section drawer__section--ask">
					<h3>Waiting for the other racers</h3>
					<p>The judge picks once every lane finishes. You can pick this one now instead.</p>
					<button type="button" className="button button--go" disabled={busy} onClick={() => act(() => api.pickWinner(props.repo, change.race!.group, change.id))}>
						Pick as winner
					</button>
				</section>
			)}

			{error && <p className="drawer__error">{error}</p>}

			<section className="drawer__section">
				<h3>Intent</h3>
				{intent ? (
					<>
						<p>{intent.summary}</p>
						<ul className="chips">
							{intent.symbols.map((s) => (
								<li key={`${s.path}#${s.name}`} className="chip">
									{s.name} <span className="chip__path">{s.path}</span>
								</li>
							))}
							{intent.paths
								.filter((p) => !intent.symbols.some((s) => s.path === p))
								.map((p) => (
									<li key={p} className="chip chip--path">
										{p}
									</li>
								))}
						</ul>
					</>
				) : (
					<p className="muted">The agent hasn’t declared what it will change yet.</p>
				)}
			</section>

			<section className="drawer__section">
				<h3>Evidence</h3>
				{evidence.length === 0 ? (
					<p className="muted">Nothing has run yet. Evidence appears once the change enters the convergence queue.</p>
				) : (
					<ul className="evidence">
						{evidence.map((e) => (
							<li key={e.id} className={`evidence__item evidence__item--${e.ok ? "ok" : "fail"}`}>
								<details>
									<summary>
										<span className="evidence__mark">{e.ok ? "passed" : "failed"}</span>
										<span className="evidence__cmd">{e.command}</span>
									</summary>
									<pre>{e.output || "(no output)"}</pre>
								</details>
							</li>
						))}
					</ul>
				)}
			</section>

			{review && (
				<section className="drawer__section">
					<h3>Review</h3>
					<div className="meter" role="img" aria-label={`Review score ${Math.round(review.score * 100)} out of 100`}>
						<span className="meter__fill" style={{ width: `${review.score * 100}%` }} />
					</div>
					<p>{review.summary}</p>
					{review.concerns.length > 0 && (
						<ul className="concerns">
							{review.concerns.map((c) => (
								<li key={c}>{c}</li>
							))}
						</ul>
					)}
					<p className="muted small">An opinion from {review.model}, not a test result.</p>
				</section>
			)}

			{decision && (
				<section className="drawer__section">
					<h3>{OUTCOME_COPY[decision.outcome]}</h3>
					<p>{decision.rationale}</p>
					<dl className="probs">
						{Object.entries(decision.probabilities)
							.sort((a, b) => b[1] - a[1])
							.map(([option, p]) => (
								<div key={option} className="probs__row">
									<dt>{option.length > 14 ? option.slice(0, 14) : option}</dt>
									<dd>
										<span className="probs__bar" style={{ width: `${p * 100}%` }} />
										<span className="probs__value">{Math.round(p * 100)}%</span>
									</dd>
								</div>
							))}
					</dl>
					<p className="muted small">Decided by {decision.decidedBy}.</p>
				</section>
			)}

			<footer className="drawer__footer">
				<a href={`/api/agents/${change.agentId}/transcript`} target="_blank" rel="noreferrer">
					Read the agent’s transcript
				</a>
				{change.head && <span className="hash">{change.head.slice(0, 10)}</span>}
			</footer>
		</aside>
	);
}
