import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Meter } from "@cloudflare/kumo/components/meter";
import { ArrowSquareOutIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Decision } from "../../domain/types.ts";
import { usd } from "../../domain/pricing.ts";
import { api, type ChangeDetail, modelLabel } from "../api.ts";
import { StatusHex } from "./ChangeCard.tsx";
import { DiffView } from "./DiffView.tsx";
import { EvidenceList } from "./Evidence.tsx";
import { SignInToAct, useCanWrite } from "../ui/Account.tsx";

const PURPOSE: Record<string, string> = { agent: "Agent", review: "Review", clef: "Clef", overlap: "Overlap check", "agent-box": "Agent box", "merge-box": "Merge box" };
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

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
	const [wide, setWide] = useState(false);

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

	return (
		<motion.aside
			initial={{ x: "100%" }}
			animate={{ x: 0 }}
			exit={{ x: "100%" }}
			transition={{ type: "spring", stiffness: 380, damping: 38 }}
			className={`fixed inset-y-0 right-0 z-40 flex w-full ${wide ? "max-w-[min(1100px,100vw)]" : "max-w-[460px]"} flex-col border-l transition-[max-width] duration-300 border-white/10 bg-[#111114]/95 shadow-2xl backdrop-blur-xl`}
			aria-label={detail ? `Change ${detail.change.id}` : "Change details"}
		>
			<header className="flex items-start gap-3 border-b border-white/5 p-5">
				{detail && <StatusHex status={detail.change.status} size={12} />}
				<div className="min-w-0 flex-1">
					<h2 className="font-mono text-sm text-kumo-subtle">{props.changeId}</h2>
					<p className="mt-1 font-display text-xl font-semibold leading-tight text-wax">{detail?.goal?.title ?? "Loading change"}</p>
					{detail && <p className="mt-1 text-sm text-kumo-subtle">{detail.change.model === "sim" ? "A simulated agent" : modelLabel(detail.change.model)}</p>}
				</div>
				<Button variant="ghost" shape="square" icon={XIcon} onClick={props.onClose} aria-label="Close details" />
			</header>

			{!detail ? (
				<p className="p-5 text-kumo-subtle">{error ?? "Loading"}</p>
			) : (
				<Body detail={detail} busy={busy} error={error} act={act} repo={props.repo} tick={props.tick} wide={wide} setWide={setWide} />
			)}
		</motion.aside>
	);
}

function Body({
	detail,
	busy,
	error,
	act,
	repo,
	tick,
	wide,
	setWide,
}: {
	detail: ChangeDetail;
	busy: boolean;
	error: string | null;
	act: (fn: () => Promise<unknown>) => void;
	repo: string;
	tick: number;
	wide: boolean;
	setWide: (w: boolean) => void;
}) {
	const { change, intent, evidence, evaluations, decisions } = detail;
	const canWrite = useCanWrite();
	const review = evaluations.at(-1);
	const decision = decisions.at(-1);
	return (
		<div className="flex-1 space-y-7 overflow-y-auto p-5">
			{change.status === "escalated" && (
				<section className="cut-sm bg-alarm/10 p-4 ring-1 ring-alarm/40">
					<h3 className="font-display text-lg font-semibold text-wax">Hive needs your call</h3>
					<p className="mt-1 text-sm text-kumo-subtle">Hive won't land or retry this on its own: Clef wasn't sure, or the change kept failing. The reason is below. Tests still run before anything lands.</p>
					{canWrite ? (
						<div className="mt-4 flex gap-2">
							<Button variant="primary" icon={CheckIcon} loading={busy} onClick={() => act(() => api.decide(repo, change.id, "land"))}>
								Land it
							</Button>
							<Button variant="secondary" disabled={busy} onClick={() => act(() => api.decide(repo, change.id, "bounce", "Sent back from the dashboard."))}>
								Send back
							</Button>
						</div>
					) : (
						<SignInToAct className="mt-4" what="land or send back changes" />
					)}
				</section>
			)}

			{change.status === "evaluated" && change.race && (
				<section className="cut-sm bg-flare/10 p-4 ring-1 ring-flare/40">
					<h3 className="font-display text-lg font-semibold text-wax">Waiting for the other racers</h3>
					<p className="mt-1 text-sm text-kumo-subtle">The judge picks once every lane finishes. You can pick this one now instead.</p>
					{canWrite ? (
						<Button className="mt-4" variant="primary" loading={busy} onClick={() => act(() => api.pickWinner(repo, change.race!.group, change.id))}>
							Pick as winner
						</Button>
					) : (
						<SignInToAct className="mt-4" what="pick a race's winner" />
					)}
				</section>
			)}

			{error && <p className="text-sm text-kumo-danger">{error}</p>}

			<Block title="Intent">
				{intent ? (
					<>
						<p className="text-kumo-default">{intent.summary}</p>
						<ul className="mt-3 flex flex-wrap gap-1.5">
							{intent.symbols.map((s) => (
								<li key={`${s.path}#${s.name}`}>
									<Badge variant="orange">
										{s.name} <span className="ml-1 opacity-70">{s.path}</span>
									</Badge>
								</li>
							))}
							{intent.paths
								.filter((p) => !intent.symbols.some((s) => s.path === p))
								.map((p) => (
									<li key={p}>
										<Badge variant="neutral">{p}</Badge>
									</li>
								))}
						</ul>
					</>
				) : (
					<p className="text-kumo-subtle">The agent hasn't declared what it will change yet.</p>
				)}
			</Block>

			{change.model !== "sim" && (
				<Block
					title="Changes"
					action={
						<button type="button" onClick={() => setWide(!wide)} className="text-xs text-kumo-subtle hover:text-honey">
							{wide ? "Narrow" : "Widen"}
						</button>
					}
				>
					<DiffView repo={repo} changeId={change.id} intent={intent} tick={tick} />
				</Block>
			)}

			<Block title="Evidence">
				{evidence.length === 0 ? (
					<p className="text-kumo-subtle">Nothing has run yet. Evidence appears once the change is in a batch.</p>
				) : (
					<EvidenceList runs={evidence} />
				)}
			</Block>

			{review && (
				<Block title="Review">
					<Meter label="Review score" value={Math.round(review.score * 100)} customValue={`${Math.round(review.score * 100)} / 100`} indicatorClassName="!bg-steel" />
					<p className="mt-3 text-kumo-default">{review.summary}</p>
					{review.concerns.length > 0 && (
						<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-kumo-subtle">
							{review.concerns.map((c) => (
								<li key={c}>{c}</li>
							))}
						</ul>
					)}
					<p className="mt-2 text-xs text-kumo-subtle">An opinion from {review.model}, not a test result.</p>
				</Block>
			)}

			{decision && (
				<Block title={OUTCOME_COPY[decision.outcome]}>
					<p className="text-kumo-default">{decision.rationale}</p>
					<dl className="mt-4 space-y-2">
						{Object.entries(decision.probabilities)
							.sort((a, b) => b[1] - a[1])
							.map(([option, p], i) => (
								<div key={option} className="grid grid-cols-[96px_1fr_44px] items-center gap-3 text-sm">
									<dt className="truncate text-kumo-subtle">{option}</dt>
									<dd className="h-1.5 bg-white/5">
										<motion.div
											className={`h-full origin-left ${i === 0 ? "bg-honey" : "bg-flare/60"}`}
											style={{ width: `${p * 100}%` }}
											initial={{ scaleX: 0 }}
											animate={{ scaleX: 1 }}
											transition={{ delay: 0.1 + i * 0.08, duration: 0.6 }}
										/>
									</dd>
									<dd className="text-right tabular text-kumo-default">{Math.round(p * 100)}%</dd>
								</div>
							))}
					</dl>
					<p className="mt-3 text-xs text-kumo-subtle">Decided by {decision.decidedBy}.</p>
				</Block>
			)}

			{detail.cost && detail.cost.total > 0 && (
				<Block title={`Cost: ${usd(detail.cost.total)}`}>
					<ul className="space-y-1 text-sm">
						{detail.cost.parts
							.sort((a, b) => b.cost - a.cost)
							.map((p) => (
								<li key={`${p.purpose}${p.model}`} className="flex items-baseline gap-3">
									<span className="w-24 shrink-0 text-kumo-subtle">{PURPOSE[p.purpose] ?? p.purpose}</span>
									<span className="min-w-0 flex-1 truncate text-kumo-default">
										{p.model.startsWith("container:") ? p.model.slice(10) : modelLabel(p.model)}
										<span className="ml-2 text-xs text-kumo-subtle">
											{p.seconds > 0 ? `${Math.round(p.seconds / 60)} min` : `${tokens(p.inputTokens)} in, ${tokens(p.outputTokens)} out`}
										</span>
									</span>
									<span className="tabular text-kumo-default">{usd(p.cost)}</span>
								</li>
							))}
					</ul>
					<p className="mt-2 text-xs text-kumo-subtle">At Workers AI and Containers list prices.</p>
				</Block>
			)}

			<footer className="flex items-center justify-between border-t border-white/5 pt-4 text-sm">
				{change.model === "sim" ? (
					<span className="text-kumo-subtle">Simulated agents have no transcript.</span>
				) : (
					<a href={`/api/agents/${change.agentId}/transcript`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-honey hover:underline">
						Read the agent's transcript <ArrowSquareOutIcon size={14} />
					</a>
				)}
				{change.head && <span className="font-mono text-xs text-kumo-subtle">{change.head.slice(0, 10)}</span>}
			</footer>
		</div>
	);
}

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section>
			<div className="mb-2.5 flex items-center justify-between gap-3">
				<h3 className="font-display text-sm font-semibold tracking-wide text-honey">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	);
}
