import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { Goal } from "../../domain/types.ts";
import { parseSecurity } from "../../evidence/parse.ts";
import type { Snapshot } from "../api.ts";
import { hexPoints } from "../hex/geometry.ts";
import { PLAN_LEGEND, PlanGraph } from "../hex/PlanGraph.tsx";
import { Section } from "../ui/Section.tsx";

const rise = {
	initial: { opacity: 0, y: 14 },
	whileInView: { opacity: 1, y: 0 },
	viewport: { once: true, margin: "-60px" },
	transition: { duration: 0.5, ease: [0.2, 0.7, 0.2, 1] as const },
};

const LANGUAGES = [
	{ name: "Node", found: "package.json", checks: ["typecheck", "build", "test scripts"] },
	{ name: "Rust", found: "Cargo.toml", checks: ["cargo build", "cargo test"] },
	{ name: "Python", found: "pyproject.toml", checks: ["pytest"] },
	{ name: "Go", found: "go.mod", checks: ["go vet", "go build", "go test"] },
	{ name: "Anything", found: "hive.json", checks: ["your setup", "your checks"] },
];

// Production runs, verified with stock git clones of the resulting trunks.
const IMPORTED = [
	{ repo: "dtolnay/itoa", lang: "Rust", detail: "329 commits in 35 s. A Kimi K2.7 agent added a test; cargo build and cargo test passed in the merge box; Clef landed it.", href: "/r/itoa" },
	{ repo: "pypa/sampleproject", lang: "Python", detail: "pytest in a fresh virtualenv, dependencies from PyPI through the egress gateway.", href: "/r/sampleproject" },
	{ repo: "google/uuid", lang: "Go", detail: "go vet, go build and go test, modules from the Go proxy.", href: "/r/uuid" },
];

export function AnyCodebase() {
	return (
		<Section id="codebase" title="Bring any codebase">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Import a repository from GitHub or any git server, with its full history. Hive works out how to build and test it, and the merge queue holds every change to those
				checks, in the repository's own language.
			</p>
			<div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
				<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
					{LANGUAGES.map((l, i) => (
						<motion.li key={l.name} {...rise} transition={{ ...rise.transition, delay: i * 0.06 }} className="cut-sm bg-comb/50 p-4 ring-1 ring-comb-line">
							<svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
								<polygon points={hexPoints(11, 12, 10.5)} fill={l.name === "Anything" ? "rgba(246,130,31,0.25)" : "rgba(251,173,65,0.85)"} stroke="#fbad41" />
							</svg>
							<p className="mt-3 font-display text-lg font-semibold text-wax">{l.name}</p>
							<p className="font-mono text-xs text-honey">{l.found}</p>
							<p className="mt-2 text-sm text-kumo-subtle">{l.checks.join(", ")}</p>
						</motion.li>
					))}
				</ul>
				<div className="space-y-4">
					<motion.pre {...rise} className="cut overflow-x-auto bg-[#0a0a0c] p-5 font-mono text-[13px] leading-relaxed ring-1 ring-comb-line">
						<span className="text-kumo-subtle"># hive.json: say exactly what proves this repository works</span>
						{"\n"}
						<span className="text-kumo-default">{"{"}</span>
						{"\n  "}
						<span className="text-honey">"setup"</span>
						<span className="text-kumo-default">: ["make deps"],</span>
						{"\n  "}
						<span className="text-honey">"checks"</span>
						<span className="text-kumo-default">{': { "test": "make test", "lint": "make lint" },'}</span>
						{"\n  "}
						<span className="text-honey">"security"</span>
						<span className="text-kumo-default">: true</span>
						{"\n"}
						<span className="text-kumo-default">{"}"}</span>
					</motion.pre>
					<p className="text-sm leading-relaxed text-kumo-subtle">
						Agents get the same plan as a tool, <code className="font-mono text-kumo-default">run_checks</code>, so they see exactly what the queue will run before they submit.
					</p>
				</div>
			</div>
			<h3 className="mb-4 mt-16 font-display text-xl font-semibold text-wax">Imported and checked in production</h3>
			<ul className="grid gap-px overflow-hidden bg-comb-line md:grid-cols-3">
				{IMPORTED.map((r) => (
					<li key={r.repo} className="bg-night p-5">
						<p className="flex items-baseline justify-between gap-3">
							<a href={r.href} className="font-mono text-sm text-honey hover:underline">
								{r.repo}
							</a>
							<span className="text-xs text-kumo-subtle">{r.lang}</span>
						</p>
						<p className="mt-2 text-sm leading-relaxed text-kumo-subtle">{r.detail}</p>
					</li>
				))}
			</ul>
		</Section>
	);
}

const SECURITY_REPO = "vulnshop";

interface SecurityTally {
	plan: { parent: Goal; children: Goal[]; deps: [string, string][] } | null;
	resolved: number; // findings fixed by changes that landed
	blocked: number; // scans that failed a change for a finding it introduced
	landed: number;
}

// Everything on this part of the page is read live from the security run's coordinator.
function useSecurityRun(): SecurityTally | null {
	const [tally, setTally] = useState<SecurityTally | null>(null);
	useEffect(() => {
		let stop = false;
		const load = async () => {
			try {
				const snap = (await (await fetch(`/api/repos/${SECURITY_REPO}`)).json()) as Snapshot;
				const parent = [...snap.goals].reverse().find((g) => snap.goals.some((c) => c.parentId === g.id)) ?? null;
				const children = parent ? snap.goals.filter((g) => g.parentId === parent.id) : [];
				const changes = snap.changes.filter((c) => c.status !== "archived").slice(0, 40);
				// A batch's scan covers its whole stack, so changes in one batch report the same
				// resolved findings: count each finding once.
				const resolvedKeys = new Set<string>();
				let blocked = 0;
				let landed = 0;
				await Promise.all(
					changes.map(async (c) => {
						const d = (await (await fetch(`/api/repos/${SECURITY_REPO}/changes/${c.id}`)).json()) as { evidence: { kind: string; ok: boolean; output: string }[] };
						const scans = d.evidence.filter((e) => e.kind === "security");
						blocked += scans.filter((e) => !e.ok).length;
						if (c.status === "landed") {
							landed++;
							const last = scans.at(-1);
							for (const f of last ? parseSecurity(last.output).resolved : []) resolvedKeys.add(`${f.tool}|${f.rule}|${f.where}`);
						}
					}),
				);
				if (!stop) setTally({ plan: parent ? { parent, children, deps: snap.goalDeps ?? [] } : null, resolved: resolvedKeys.size, blocked, landed });
			} catch {
				// the section falls back to its explanation alone
			}
		};
		load();
		const t = setInterval(load, 20_000);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, []);
	return tally;
}

export function SecurityAndPlans() {
	const run = useSecurityRun();
	return (
		<>
			<Security run={run} />
			<Plans run={run} />
		</>
	);
}

function Security({ run }: { run: SecurityTally | null }) {
	// Numbers only once the live run has some; until then the cards explain.
	const live = run && (run.landed > 0 || run.blocked > 0) ? run : null;
	const cards = [
		{ label: "Introduced", tone: "text-alarm", value: live ? live.blocked : null, text: "A finding the change adds fails it, exactly like a failing test. Inside a batch, the culprit search isolates it." },
		{ label: "Resolved", tone: "text-honey", value: live ? live.resolved : null, text: "Findings on trunk that a change removes are listed with it. That's how a security fix shows its work." },
		{ label: "Unchanged", tone: "text-steel", value: null, text: "Findings already on trunk block nobody, so an existing codebase isn't frozen by its history." },
	];
	return (
		<Section id="security" title="Security is evidence too">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Turn it on and every batch also runs gitleaks for secrets, osv-scanner for vulnerable dependencies and Semgrep for risky code, then compares the findings with trunk's.
				Findings are fingerprinted by rule and code, not line number, so moving code around doesn't count as new.
			</p>
			<div className="grid gap-4 md:grid-cols-3">
				{cards.map((c, i) => (
					<motion.div key={c.label} {...rise} transition={{ ...rise.transition, delay: i * 0.08 }} className="cut bg-comb/50 p-6 ring-1 ring-comb-line">
						<p className={`font-display text-sm font-semibold ${c.tone}`}>{c.label}</p>
						{c.value !== null && <p className={`mt-2 font-display text-5xl font-semibold tabular ${c.tone}`}>{c.value}</p>}
						<p className="mt-3 leading-relaxed text-kumo-subtle">{c.text}</p>
					</motion.div>
				))}
			</div>
			{live && (
				<p className="mt-5 text-sm text-kumo-subtle">
					Live from{" "}
					<a href={`/r/${SECURITY_REPO}`} className="text-honey hover:underline">
						{SECURITY_REPO}
					</a>
					, a service with planted vulnerabilities: {live.resolved} findings resolved by {live.landed} landed changes so far, and {live.blocked} scans that sent a change back.
				</p>
			)}
		</Section>
	);
}

function Plans({ run }: { run: SecurityTally | null }) {
	const plan = run?.plan;
	const done = plan ? plan.children.filter((c) => c.status === "achieved").length : 0;
	const working = plan ? plan.children.filter((c) => c.status === "in_progress" || c.status === "racing").length : 0;
	const legend = useMemo(() => PLAN_LEGEND, []);
	return (
		<Section id="plans" title="One big goal, many agents" className="comb-bg">
			<p className="mb-10 max-w-2xl text-lg text-kumo-subtle">
				Some goals are too big for one agent: fix every security issue, port a service to Rust. A planner reads the code (files, symbols, who calls what) and splits the goal
				into sub-goals that each land on their own, with the order between them. Hive starts agents on every sub-goal that's ready, many at once, and the next ones as each
				lands.
			</p>
			<div className="cut bg-[#0f0f12] p-5 ring-1 ring-comb-line sm:p-7">
				{plan && plan.children.length > 0 ? (
					<>
						<div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
							<p className="font-display text-lg font-semibold text-wax">“{plan.parent.title}”</p>
							<p className="text-sm text-kumo-subtle">
								<span className="tabular text-wax">{plan.children.length}</span> sub-goals, <span className="tabular text-honey">{done}</span> landed,{" "}
								<span className="tabular text-flare">{working}</span> with an agent now
							</p>
							<ul className="flex gap-4 text-xs text-kumo-subtle sm:ml-auto">
								{legend.map((l) => (
									<li key={l.label} className="flex items-center gap-1.5">
										<svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
											<polygon points={hexPoints(5.5, 6, 5)} fill={l.fill} stroke={l.stroke} />
										</svg>
										{l.label}
									</li>
								))}
							</ul>
						</div>
						<PlanGraph goals={plan.children} deps={plan.deps} />
						<p className="mt-4 text-sm text-kumo-subtle">
							Live from{" "}
							<a href={`/r/${SECURITY_REPO}`} className="text-honey hover:underline">
								{SECURITY_REPO}
							</a>
							: GLM 5.3 planned it; Kimi K2.7 agents {done === plan.children.length ? "did it, then a follow-up goal finished the dependency upgrade" : "are doing it"}.
						</p>
					</>
				) : (
					<p className="text-kumo-subtle">{run ? "The planner is reading the code. The plan appears here as soon as it's proposed." : "Loading the live plan."}</p>
				)}
			</div>
		</Section>
	);
}
