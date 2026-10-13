import { LinkButton } from "@cloudflare/kumo/components/button";
import { CloudflareLogo } from "@cloudflare/kumo/components/cloudflare-logo";
import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { HiveCanvas } from "../hex/HiveCanvas.tsx";
import { HiveMark, Wordmark } from "../ui/Logo.tsx";
import { Section } from "../ui/Section.tsx";
import { useHiveStats } from "../stats.ts";
import { GITHUB, LIVE_REPO } from "../links.ts";
import { VERSION } from "../version.ts";
import { BatchDemo } from "./BatchDemo.tsx";
import { AnyCodebase, SecurityAndPlans } from "./codebase.tsx";
import { GetStarted, Lifecycle, Overlaps, Problem, Race, Record, Stack, WorkWithAgents } from "./sections.tsx";
import { Account } from "../ui/Account.tsx";


// The 2,000-agent run, as verified with a stock git clone (README, "What's been verified").
const VERIFIED = { landed: 1987, perMinute: 125.3, escalated: 13, waitP50: 144_100, batches: 32, avgBatch: 63.3, intentP50: 137 };

interface Stats {
	changes: Record<string, number>;
	landed: number;
	landedPerMinute: number | null;
	queueWaitMs: { p50: number | null };
	batches: { count: number; avgSize: number | null };
	intentCheckMs: { p50: number | null };
}

function useProof() {
	const [proof, setProof] = useState(VERIFIED);
	const [live, setLive] = useState(false);
	useEffect(() => {
		fetch(`/api/repos/${LIVE_REPO}/stats`)
			.then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
			.then((s) => {
				if (!s || s.landed < 100) return;
				setProof({
					landed: s.landed,
					perMinute: s.landedPerMinute ?? VERIFIED.perMinute,
					escalated: s.changes.escalated ?? 0,
					waitP50: s.queueWaitMs.p50 ?? VERIFIED.waitP50,
					batches: s.batches.count,
					avgBatch: s.batches.avgSize ?? VERIFIED.avgBatch,
					intentP50: s.intentCheckMs.p50 ?? VERIFIED.intentP50,
				});
				setLive(true);
			})
			.catch(() => {});
	}, []);
	return { proof, live };
}

export function Landing() {
	return (
		<div className="min-h-screen overflow-x-clip bg-night text-kumo-default">
			<Nav />
			<Hero />
			<Proof />
			<Problem />
			<Lifecycle />
			<AnyCodebase />
			<Section id="batches" title="Find the broken change without testing them one by one">
				<p className="mb-10 max-w-2xl text-lg text-kumo-subtle">
					Hive stacks queued changes on trunk and tests the stack once. When a batch fails, it checks trunk on its own, then splits the batch and keeps every half that passes. This
					demo runs the same search code the merge queue runs in production.
				</p>
				<BatchDemo />
			</Section>
			<SecurityAndPlans />
			<Overlaps />
			<Race />
			<WorkWithAgents />
			<Record />
			<Stack />
			<GetStarted />
			<Footer />
		</div>
	);
}

function Nav() {
	const links = [
		["How it works", "#lifecycle"],
		["Any codebase", "#codebase"],
		["Security", "#security"],
		["Plans", "#plans"],
		["Get started", "#start"],
		["Repositories", "/repos"],
		["Docs", "/docs"],
	];
	return (
		<header className="fixed inset-x-0 top-0 z-30 border-b border-white/5 bg-night/70 backdrop-blur-md">
			<nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-8" aria-label="Main">
				<Wordmark />
				<ul className="ml-auto hidden items-center gap-6 text-sm text-kumo-subtle md:flex">
					{links.map(([label, href]) => (
						<li key={href}>
							<a href={href} className="transition-colors hover:text-wax">
								{label}
							</a>
						</li>
					))}
				</ul>
				<a href="/docs" className="ml-auto text-sm text-kumo-subtle transition-colors hover:text-wax md:hidden">
					Docs
				</a>
				<span className="hidden lg:block">
					<Account />
				</span>
				<a href={GITHUB} className="text-kumo-subtle transition-colors hover:text-wax" aria-label="Source on GitHub">
					<GithubLogoIcon size={22} />
				</a>
				<LinkButton href={`/r/${LIVE_REPO}`} className="hidden sm:block" variant="primary" size="sm" icon={<HiveMark size={16} className="block shrink-0" />}>
							Open the live hive
						</LinkButton>
			</nav>
		</header>
	);
}

function Hero() {
	const stats = useHiveStats();
	return (
		<section className="relative flex min-h-[100svh] items-end overflow-hidden pb-16 pt-28 sm:items-center sm:pb-0">
			<HiveCanvas className="absolute inset-0 h-full w-full" />
			{/* Keep the copy readable over the hive. */}
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_55%,rgba(13,13,15,0.92)_0%,rgba(13,13,15,0.7)_38%,rgba(13,13,15,0)_72%)]" />
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night to-transparent" />
			<div className="relative mx-auto w-full max-w-6xl px-4 sm:px-8">
				<motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }} className="max-w-2xl">
					<h1 className="font-display text-5xl font-bold leading-[0.95] text-wax sm:text-7xl lg:text-8xl">
						Thousands of agents.
						<br />
						<span className="text-honey text-glow">One trunk.</span>
					</h1>
					<p className="mt-7 max-w-xl text-lg leading-relaxed text-kumo-default sm:text-xl">
						Hive is version control for AI agents working at the same time. Bring any repository: every change gets its own fork, says what it will touch before it writes
						code, and lands only when its tests, security scan and a calibrated decision say so. All of it runs on Cloudflare.
					</p>
					<div className="mt-9 flex flex-wrap gap-3">
						<LinkButton href={`/r/${LIVE_REPO}`} variant="primary" size="lg" icon={ArrowRightIcon}>
							Watch 2,000 agents land
						</LinkButton>
						<LinkButton href="#start" variant="secondary" size="lg">
							Get started
						</LinkButton>
					</div>
				</motion.div>
			</div>
			<div className="absolute bottom-5 right-4 hidden max-w-md text-right text-xs leading-relaxed text-kumo-subtle sm:right-8 sm:block">
				<p>
					An illustration: each cell is an agent, <span className="text-steel">working</span>, <span className="text-flare">in a batch</span>,{" "}
					<span className="text-honey">landed</span> or <span className="text-alarm">sent back</span>.
				</p>
				{stats && (
					<p className="mt-1">
						For real, on this deployment: <span className="tabular text-wax">{stats.totals.landed.toLocaleString()}</span> changes landed across{" "}
						<span className="tabular text-wax">{stats.totals.repos}</span> repositories, <span className="tabular text-wax">{stats.totals.aiLanded}</span> of them written by AI
						agents.
					</p>
				)}
			</div>
		</section>
	);
}

function Proof() {
	const { proof, live } = useProof();
	const min = (ms: number) => `${(ms / 60000).toFixed(1)} min`;
	const cells: { value: string; label: string; note: string }[] = [
		{ value: proof.landed.toLocaleString(), label: "changes landed", note: "from 2,000 agents on one repository" },
		{ value: `${Math.round(proof.perMinute)}/min`, label: "sustained landings", note: `${proof.batches} batches, ${Math.round(proof.avgBatch)} changes on average` },
		{ value: proof.escalated.toLocaleString(), label: "sent to a person", note: "exactly the agents that were broken on purpose" },
		{ value: min(proof.waitP50), label: "submit to trunk", note: "median, while 2,000 agents were submitting" },
	];
	return (
		<Section id="proof" title="2,000 agents on one repository, verified with plain git">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Simulated agents did exactly what coding agents do to version control: fork, declare an intent, commit, push, submit, fix and resubmit when sent back. Everything else was
				production: Artifacts forks, the coordinator, batch workflows, merge containers running real git and real tests.
			</p>
			<div className="grid gap-px overflow-hidden bg-comb-line sm:grid-cols-2 lg:grid-cols-4">
				{cells.map((c, i) => (
					<motion.div
						key={c.label}
						initial={{ opacity: 0 }}
						whileInView={{ opacity: 1 }}
						viewport={{ once: true }}
						transition={{ delay: i * 0.08 }}
						className="relative bg-night p-6 sm:p-8"
					>
						<p className="font-display text-5xl font-semibold text-honey tabular">{c.value}</p>
						<p className="mt-3 font-medium text-wax">{c.label}</p>
						<p className="mt-1 text-sm text-kumo-subtle">{c.note}</p>
					</motion.div>
				))}
			</div>
			<p className="mt-6 text-sm text-kumo-subtle">
				{live ? "Read live from the run's coordinator on this deployment." : "From the verified scale2k run."} Afterwards, a stock <code className="font-mono text-kumo-default">git clone</code> of
				trunk had exactly one commit per landed change, every one with its <code className="font-mono text-kumo-default">Hive-Change-Id</code>, no broken code, and passing tests.{" "}
				<a href={`/r/${LIVE_REPO}`} className="text-honey underline-offset-4 hover:underline">
					Open the run
				</a>
				.
			</p>
			<HiveTotals />
		</Section>
	);
}

const MODEL_NAMES: Record<string, string> = {
	"@cf/moonshotai/kimi-k2.7-code": "Kimi K2.7",
	"@cf/zai-org/glm-5.3": "GLM 5.3",
	"@cf/deepseek-ai/deepseek-v4-pro-0813": "DeepSeek V4 Pro",
};

// Everything on this deployment, summed live: simulated load tests and real AI-agent work.
function HiveTotals() {
	const stats = useHiveStats();
	if (!stats) return null;
	const t = stats.totals;
	const cells = [
		{ value: t.repos.toLocaleString(), label: "repositories" },
		{ value: t.landed.toLocaleString(), label: "changes landed" },
		{ value: t.aiLanded.toLocaleString(), label: "written by AI agents" },
		{ value: t.batches.toLocaleString(), label: "batches verified" },
		{ value: t.plans.toLocaleString(), label: "goals planned" },
	];
	return (
		<div className="mt-14">
			<h3 className="font-display text-xl font-semibold text-wax">Everything on this deployment, live</h3>
			<dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden bg-comb-line sm:grid-cols-5">
				{cells.map((c) => (
					<div key={c.label} className="bg-night p-5">
						<dt className="text-sm text-kumo-subtle">{c.label}</dt>
						<dd className="mt-1 font-display text-3xl font-semibold text-wax tabular">{c.value}</dd>
					</div>
				))}
			</dl>
			<p className="mt-3 text-sm text-kumo-subtle">
				Models that wrote landed code: {t.models.map((m) => MODEL_NAMES[m] ?? m.split("/").at(-1)).join(", ") || "none yet"}. Languages checked:{" "}
				{["node", ...t.languages].filter((l, i, a) => a.indexOf(l) === i).join(", ")}. Load tests use simulated agents; everything else is real models on real code.
			</p>
		</div>
	);
}

function Footer() {
	return (
		<footer className="border-t border-white/5 px-4 py-12 sm:px-8">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center">
				<Wordmark />
				<p className="text-sm text-kumo-subtle">
					<a href={`${GITHUB}/releases`} className="font-mono text-kumo-default hover:text-honey">
						v{VERSION}
					</a>
					, open source under the MIT license. Built and maintained by{" "}
					<a href="https://github.com/karanbalaji" className="text-kumo-default hover:text-honey">
						Karan Balaji
					</a>
					, for Cloudflare's next Git platform challenge.
				</p>
				<div className="flex items-center gap-4 sm:ml-auto">
					<a href={GITHUB} className="text-sm text-kumo-subtle hover:text-wax">
						GitHub
					</a>
					<span className="flex items-center gap-2 text-sm text-kumo-subtle">
						Runs on <CloudflareLogo className="h-5 w-auto" />
					</span>
				</div>
			</div>
		</footer>
	);
}
