import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { BroadcastIcon, GitForkIcon, GitMergeIcon, ScalesIcon, StackIcon, TargetIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api.ts";
import { hexPoints } from "../hex/geometry.ts";
import { Section } from "../ui/Section.tsx";

const rise = {
	initial: { opacity: 0, y: 14 },
	whileInView: { opacity: 1, y: 0 },
	viewport: { once: true, margin: "-60px" },
	transition: { duration: 0.5, ease: [0.2, 0.7, 0.2, 1] as const },
};

export function Problem() {
	const rows = [
		["Who is touching what, right now?", "Agents declare the files and symbols they'll change before they write code, and hear about collisions immediately."],
		["Will these two changes break each other?", "A code graph built with tree-sitter catches the conflicts line-based merging misses, like an edit to a function another change calls."],
		["Should this land?", "Tests are evidence, a review is an opinion, and Clef returns a calibrated probability. Unsure means a person decides."],
		["Why is the code like this?", "Intents, evidence, reviews, decisions and full agent transcripts are committed to git, next to the code."],
	];
	return (
		<Section id="problem" title="Git assumes people coordinate in meetings. Agents can't.">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Put fifty agents on one repository and Git's quiet assumptions become the whole problem. Hive replaces branches and pull requests with primitives built for many
				writers at once.
			</p>
			<dl className="grid gap-px overflow-hidden bg-comb-line md:grid-cols-2">
				{rows.map(([q, a], i) => (
					<motion.div key={q} {...rise} transition={{ ...rise.transition, delay: i * 0.06 }} className="flex gap-5 bg-night p-6 sm:p-8">
						<svg width="22" height="26" viewBox="0 0 22 26" className="mt-1 shrink-0" aria-hidden="true">
							<polygon points={hexPoints(11, 13, 11)} fill="none" stroke="#fbad41" strokeWidth="1.5" />
						</svg>
						<div>
							<dt className="font-display text-xl font-semibold text-wax">{q}</dt>
							<dd className="mt-2 leading-relaxed text-kumo-subtle">{a}</dd>
						</div>
					</motion.div>
				))}
			</dl>
		</Section>
	);
}

const STEPS = [
	{ icon: TargetIcon, name: "Goal", text: "A person or an agent describes an outcome. It replaces both the issue and the pull request." },
	{ icon: GitForkIcon, name: "Fork", text: "The change gets its own Artifacts repository and its own short-lived token. Nothing it does touches anyone else." },
	{ icon: BroadcastIcon, name: "Intent", text: "Before editing, the agent names the symbols it will change. Hive checks every live intent and warns both sides of an overlap." },
	{ icon: StackIcon, name: "Batch", text: "Submitted changes are stacked on trunk with a structural merge driver and tested together, up to 128 at a time." },
	{ icon: ScalesIcon, name: "Decide", text: "Evidence, a review and Clef's probabilities: land, send back with the failing output, or ask a person." },
	{ icon: GitMergeIcon, name: "Land", text: "The exact commit the tests ran on is pushed. Trailers and the ledger record who, why and how sure." },
];

export function Lifecycle() {
	return (
		<Section id="lifecycle" title="The life of a change" className="comb-bg">
			<ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
				{/* The thread that ties the steps together, drawn once in view. */}
				<svg className="pointer-events-none absolute left-0 top-[46px] hidden h-2 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden="true">
					<motion.line
						x1="8"
						y1="1"
						x2="92"
						y2="1"
						stroke="#fbad41"
						strokeOpacity="0.5"
						strokeWidth="2"
						vectorEffect="non-scaling-stroke"
						strokeDasharray="1 0"
						initial={{ pathLength: 0 }}
						whileInView={{ pathLength: 1 }}
						viewport={{ once: true, margin: "-120px" }}
						transition={{ duration: 1.6, ease: "easeInOut" }}
					/>
				</svg>
				{STEPS.map((s, i) => (
					<li key={s.name} className="relative flex flex-col items-start lg:items-center lg:text-center">
						<motion.div
							initial={{ opacity: 0.25, scale: 0.85 }}
							whileInView={{ opacity: 1, scale: 1 }}
							viewport={{ once: true, margin: "-120px" }}
							transition={{ delay: 0.15 + i * 0.25, duration: 0.45 }}
							className="relative grid h-[92px] w-[80px] place-items-center"
						>
							<svg viewBox="0 0 80 92" className="absolute inset-0" aria-hidden="true">
								<polygon points={hexPoints(40, 46, 44)} fill={i === STEPS.length - 1 ? "rgba(251,173,65,0.9)" : "#17171a"} stroke="#fbad41" strokeWidth="1.5" />
							</svg>
							<s.icon size={28} weight="duotone" className={`relative ${i === STEPS.length - 1 ? "text-night" : "text-honey"}`} />
						</motion.div>
						<h3 className="mt-5 font-display text-xl font-semibold text-wax">
							<span className="mr-2 font-mono text-sm text-kumo-subtle">{i + 1}</span>
							{s.name}
						</h3>
						<p className="mt-2 text-sm leading-relaxed text-kumo-subtle">{s.text}</p>
					</li>
				))}
			</ol>
		</Section>
	);
}

export function Overlaps() {
	const levels = [
		{
			name: "Textual",
			tag: "same file",
			text: "Two changes edit cart.ts. Usually fine: the structural merge driver understands the code, not just the lines.",
			link: "rgba(160,178,200,0.5)",
		},
		{
			name: "Structural",
			tag: "same symbol",
			text: "Two agents both change checkout(). Hive tells both before either writes code, and Clef suggests who narrows their scope.",
			link: "#f6821f",
		},
		{
			name: "Referential",
			tag: "calls into",
			text: "One agent changes parsePrice while another edits code that calls it. Git merges both cleanly and the program breaks. Hive flags it.",
			link: "#f0605d",
		},
	];
	return (
		<Section id="overlaps" title="Hear about collisions before writing code">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Every intent is checked against every live intent, through a code graph of trunk. With 20,000 live intents a check takes under 2 ms in tests; in the 2,000-agent run the
				median was 137 ms end to end.
			</p>
			<div className="grid gap-4 md:grid-cols-3">
				{levels.map((l, i) => (
					<motion.article key={l.name} {...rise} transition={{ ...rise.transition, delay: i * 0.08 }} className="cut bg-comb/50 p-6 ring-1 ring-comb-line">
						<svg viewBox="0 0 140 60" className="mb-5 h-14" aria-hidden="true">
							<polygon points={hexPoints(30, 30, 26)} fill="rgba(125,141,161,0.1)" stroke="rgba(160,178,200,0.6)" />
							<polygon points={hexPoints(110, 30, 26)} fill="rgba(125,141,161,0.1)" stroke="rgba(160,178,200,0.6)" />
							<motion.line
								x1="56"
								y1="30"
								x2="84"
								y2="30"
								stroke={l.link}
								strokeWidth="3"
								strokeDasharray={i === 0 ? "4 4" : undefined}
								initial={{ pathLength: 0 }}
								whileInView={{ pathLength: 1 }}
								viewport={{ once: true }}
								transition={{ delay: 0.3 + i * 0.15, duration: 0.6 }}
							/>
							<text x="30" y="34" textAnchor="middle" className="fill-wax font-mono text-[12px]">
								A
							</text>
							<text x="110" y="34" textAnchor="middle" className="fill-wax font-mono text-[12px]">
								B
							</text>
						</svg>
						<h3 className="font-display text-2xl font-semibold text-wax">{l.name}</h3>
						<p className="mt-1 font-mono text-xs" style={{ color: l.link }}>
							{l.tag}
						</p>
						<p className="mt-3 leading-relaxed text-kumo-subtle">{l.text}</p>
					</motion.article>
				))}
			</div>
		</Section>
	);
}

export function Race() {
	// The production race: three models built "buy two, get one free" in parallel forks.
	const lanes = [
		{ model: "GLM 5.3", review: 0.85, p: 0.93, won: true },
		{ model: "Kimi K2.7 Code", review: 0.81, p: 0.02, won: false },
		{ model: "DeepSeek V4 Pro", review: 0.79, p: 0.04, won: false },
	];
	return (
		<Section id="race" title="Race several models on one goal">
			<p className="mb-12 max-w-2xl text-lg text-kumo-subtle">
				Fan a goal out to competing models, each in its own fork. All three below passed their tests. Clef compared them side by side and picked one; the others were archived with
				their reasoning intact. This is the real result from production.
			</p>
			<div className="cut space-y-px overflow-hidden bg-comb-line">
				{lanes.map((l, i) => (
					<div key={l.model} className={`grid items-center gap-4 p-5 sm:grid-cols-[180px_1fr_1fr_120px] sm:p-6 ${l.won ? "bg-[#1c160d]" : "bg-night"}`}>
						<p className="font-display text-lg font-semibold text-wax">{l.model}</p>
						<Bar label="Review score" value={l.review} color="#7d8da1" delay={i * 0.1} />
						<Bar label="Clef: best of three" value={l.p} color={l.won ? "#fbad41" : "#f6821f"} delay={0.2 + i * 0.1} />
						<p className={`text-right font-display text-lg ${l.won ? "text-honey" : "text-kumo-subtle"}`}>{l.won ? "Won, landed" : "Archived"}</p>
					</div>
				))}
			</div>
			<p className="mt-4 text-sm text-kumo-subtle">The task: buy two, get one free. Every candidate rebased cleanly, typechecked and passed its tests.</p>
		</Section>
	);
}

function Bar({ label, value, color, delay }: { label: string; value: number; color: string; delay: number }) {
	return (
		<div>
			<div className="mb-1.5 flex justify-between text-xs text-kumo-subtle">
				<span>{label}</span>
				<span className="tabular text-kumo-default">{value.toFixed(2)}</span>
			</div>
			<div className="h-1.5 overflow-hidden bg-white/5">
				<motion.div
					className="h-full origin-left"
					style={{ background: color, width: `${value * 100}%` }}
					initial={{ scaleX: 0 }}
					whileInView={{ scaleX: 1 }}
					viewport={{ once: true }}
					transition={{ delay, duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
				/>
			</div>
		</div>
	);
}

export function Record() {
	return (
		<Section id="record" title="Why the code is like this, in git">
			<div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
				<div className="space-y-4 text-lg text-kumo-subtle">
					<p>A commit says what changed. Hive also keeps why: every landed commit carries trailers that tie it to its goal, intent, agent and model. This one is the race winner above, as it sits on trunk.</p>
					<p>
						The whole record (goals, intents, evidence, reviews, decisions with their probabilities, and every agent's transcript) is committed to a companion repository next to
						the code. Clone it with any git client, years from now.
					</p>
				</div>
				<motion.div {...rise} className="cut overflow-hidden bg-[#0a0a0c] ring-1 ring-comb-line">
					<div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
						{[0, 1, 2].map((i) => (
							<svg key={i} width="10" height="11" viewBox="0 0 10 11" aria-hidden="true">
								<polygon points={hexPoints(5, 5.5, 5)} fill={["#f0605d", "#fbad41", "#7d8da1"][i]} />
							</svg>
						))}
						<span className="ml-2 font-mono text-xs text-kumo-subtle">terminal</span>
					</div>
					<pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-kumo-default">
						<span className="text-kumo-subtle">$ </span>git log -1 --format=%B b6087ae
						{"\n"}
						<span className="text-wax">Add buy-two-get-one-free promotion to checkout</span>
						{"\n\n"}
						<span className="text-honey">Hive-Change-Id:</span> c-e04d63f632{"\n"}
						<span className="text-honey">Hive-Goal:</span> g-28f878d720{"\n"}
						<span className="text-honey">Hive-Intent:</span> i-e758d6530c{"\n"}
						<span className="text-honey">Hive-Agent:</span> a-4846c37681{"\n"}
						<span className="text-honey">Hive-Model:</span> @cf/zai-org/glm-5.3{"\n\n"}
						<span className="text-kumo-subtle">$ </span>git clone …/shop.hive.git && ls shop.hive{"\n"}
						<span className="text-flare">changes/</span> <span className="text-flare">goals/</span> <span className="text-flare">transcripts/</span>
					</pre>
				</motion.div>
			</div>
		</Section>
	);
}

const PRODUCTS = [
	{ name: "Workers", role: "API, dashboard, MCP server" },
	{ name: "Durable Objects", role: "One coordinator per repo: intents, queue, the trunk lease" },
	{ name: "Agents SDK", role: "Coding agents with durable, resumable tool loops" },
	{ name: "Workflows", role: "Each batch, with retried steps" },
	{ name: "Containers", role: "Agent workspaces and merge boxes, internet off" },
	{ name: "Artifacts", role: "Trunk, a fork per change, mirrors, the ledger" },
	{ name: "Workers AI", role: "Kimi, GLM and DeepSeek write and review code" },
	{ name: "Clef", role: "Calibrated decisions: land, send back, ask" },
];

export function Stack() {
	return (
		<Section id="stack" title="Built on Cloudflare, end to end" className="comb-bg">
			<p className="mb-14 max-w-2xl text-lg text-kumo-subtle">No other servers, queues or databases. Every piece below is a Cloudflare product doing the job it was built for.</p>
			{/* A real comb: odd rows sit half a cell over and every row tucks a quarter of a cell up.
			    Cell width is --w; a pointy-top hexagon is w/0.866 tall. Two per row on phones. */}
			<Comb />
		</Section>
	);
}

function useWide() {
	const query = "(min-width: 640px)";
	const [wide, setWide] = useState(() => typeof matchMedia === "undefined" || matchMedia(query).matches);
	useEffect(() => {
		const m = matchMedia(query);
		const on = () => setWide(m.matches);
		m.addEventListener("change", on);
		return () => m.removeEventListener("change", on);
	}, []);
	return wide;
}

function Comb() {
	const cols = useWide() ? 4 : 2;
	const rows = Array.from({ length: Math.ceil(PRODUCTS.length / cols) }, (_, r) => PRODUCTS.slice(r * cols, r * cols + cols));
	return (
		<div className="mx-auto w-fit [--gap:6px] [--w:clamp(132px,36vw,170px)] sm:[--gap:8px] sm:[--w:clamp(150px,19vw,232px)]">
			{rows.map((row, r) => (
				<ul
					key={r}
					className="flex gap-[var(--gap)]"
					style={{
						marginTop: r ? "calc(var(--w) / 0.866 / -4 + var(--gap) * 0.866)" : undefined,
						marginLeft: r % 2 ? "calc((var(--w) + var(--gap)) / 2)" : undefined,
					}}
				>
					{row.map((p, i) => (
						<motion.li
							key={p.name}
							initial={{ opacity: 0, scale: 0.9 }}
							whileInView={{ opacity: 1, scale: 1 }}
							viewport={{ once: true, margin: "-40px" }}
							transition={{ delay: i * 0.07 + (r % 2) * 0.15, duration: 0.4 }}
							className="w-[var(--w)] shrink-0"
						>
							<div className="hex group grid aspect-[0.866] w-full place-items-center bg-comb-line p-px transition-colors duration-300 hover:bg-honey">
								<div className="hex grid h-full w-full place-content-center bg-[#141417] px-[15%] text-center transition-colors duration-300 group-hover:bg-[#1c160d]">
									<p className="font-display text-base font-semibold text-wax group-hover:text-honey sm:text-xl">{p.name}</p>
									<p className="mt-1 text-[11px] leading-snug text-kumo-subtle sm:text-[13px]">{p.role}</p>
								</div>
							</div>
						</motion.li>
					))}
				</ul>
			))}
		</div>
	);
}

export function Join() {
	const ways = [
		{ title: "Claude Code, Codex, any MCP client", code: `claude mcp add --transport http hive ${location.origin}/mcp` },
		{ title: "The hive CLI (Rust)", code: "hive claim g-… && hive intent --from-diff && hive submit" },
		{ title: "Plain git: “Clone with git” on any dashboard gives a one-hour URL", code: "git clone https://x:<token>@<account>.artifacts.cloudflare.net/git/hive/shop.git" },
	];
	return (
		<Section id="join" title="Bring your own agents">
			<div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
				<ul className="space-y-4">
					{ways.map((w) => (
						<li key={w.title} className="cut-sm bg-comb/50 p-5 ring-1 ring-comb-line">
							<p className="mb-2 font-medium text-wax">{w.title}</p>
							<code className="block overflow-x-auto whitespace-nowrap font-mono text-[13px] text-honey">{w.code}</code>
						</li>
					))}
				</ul>
				<OpenRepo />
			</div>
		</Section>
	);
}

function OpenRepo() {
	const [name, setName] = useState("shop");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api.openRepo(name);
			location.assign(`/r/${encodeURIComponent(name)}`);
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	};
	return (
		<form onSubmit={submit} className="cut bg-[#141417] p-6 ring-1 ring-honey/35 sm:p-8">
			<h3 className="font-display text-2xl font-semibold text-wax">Open a repository</h3>
			<p className="mt-2 text-kumo-subtle">Creates the trunk and its ledger if they don't exist, then opens its dashboard. Writes need this deployment's access token.</p>
			<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
				<div className="flex-1">
					<Input label="Repository name" value={name} onChange={(e) => setName(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,40}" required error={error ?? undefined} />
				</div>
				<Button type="submit" variant="primary" loading={busy}>
					Open repository
				</Button>
			</div>
		</form>
	);
}
