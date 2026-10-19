import { LinkButton } from "@cloudflare/kumo/components/button";
import { ArrowUpRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { Wordmark } from "../ui/Logo.tsx";
import { GITHUB } from "../links.ts";

const GUIDE = `${GITHUB}/blob/main/docs/SELF-HOST.md`;
const ROADMAP = `${GITHUB}/blob/main/docs/ROADMAP.md`;
const CONTRIBUTING = `${GITHUB}/blob/main/CONTRIBUTING.md`;
const HACKATHON = "https://www.cloudflare.com/git-competition/?cf_page=next-git-platform-on-cloudflare%2F";
const AUTHOR = "https://karanbalaji.com";

const features = [
	{
		number: "01",
		title: "Coordinate before code",
		copy: "Each change gets an isolated fork. Agents declare the files and symbols they plan to touch, so Hive can flag overlapping work early.",
	},
	{
		number: "02",
		title: "Converge with evidence",
		copy: "A shared queue rebases changes, runs repository checks, gathers review, and records a calibrated decision to land, send back, or ask a person.",
	},
	{
		number: "03",
		title: "Keep the reasoning with the code",
		copy: "Intents, test results, reviews, decisions, and agent transcripts are recorded in Git, so a change can be traced back to its goal and evidence.",
	},
];

const useCases = [
	{
		title: "Parallelize repository work",
		copy: "Give independent coding agents separate goals on the same codebase, with overlap checks and one convergence queue to protect trunk.",
	},
	{
		title: "Break down a larger goal",
		copy: "Use plans to split an outcome into dependent sub-goals. Agents can start as prerequisites land, while you follow progress and intervene when needed.",
	},
	{
		title: "Compare models on a task",
		copy: "Run a goal with different models in isolated changes, compare their results and costs, and keep the winning change with its history.",
	},
];

const roadmap = [
	{
		title: "Repository-level memory",
		progress: 60,
		copy: "Build on review lessons already shared with new agents, adding lessons from decisions and changes that were fixed after being sent back.",
	},
	{
		title: "Watchers, mentions, and read-only sharing",
		progress: 10,
		copy: "Make it easier for a team to follow a repository or change and bring a person into a decision.",
	},
];

function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
	return (
		<div className="max-w-3xl">
			<p className="font-mono text-xs uppercase tracking-[0.18em] text-honey">{eyebrow}</p>
			<h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-wax sm:text-4xl">{title}</h2>
			{copy && <p className="mt-4 text-base leading-relaxed text-kumo-subtle sm:text-lg">{copy}</p>}
		</div>
	);
}

export function Landing({ selfHosted = false }: { selfHosted?: boolean }) {
	return (
		<div className="min-h-screen bg-night text-kumo-default">
			<div className="border-b border-white/5 bg-honey/10 px-4 py-2 text-center text-sm text-kumo-subtle">
				Made for the{" "}
				<a href={HACKATHON} className="text-honey hover:underline">Cloudflare hackathon</a>
				{" "}by{" "}
				<a href={AUTHOR} className="text-honey hover:underline">Karan Balaji</a>
			</div>
			<header className="border-b border-white/5">
				<nav className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-8" aria-label="Main">
					<Wordmark />
					<div className="ml-auto hidden items-center gap-6 text-sm text-kumo-subtle lg:flex">
						<a href="#features" className="hover:text-wax">Features</a>
						<a href="#use-cases" className="hover:text-wax">Use cases</a>
						<a href="#roadmap" className="hover:text-wax">Roadmap</a>
						<a href="#contribute" className="hover:text-wax">Contribute</a>
					</div>
					<a href={GITHUB} className="ml-auto inline-flex items-center gap-2 text-sm text-kumo-subtle transition-colors hover:text-wax lg:ml-8">
						<GithubLogoIcon size={19} />
						Source on GitHub
					</a>
					{selfHosted && <a href="/repos" className="ml-5 text-sm text-honey hover:underline">Open dashboard</a>}
				</nav>
			</header>

			<main>
				<section className="comb-bg border-b border-white/5">
					<div className="mx-auto max-w-6xl px-4 pb-20 pt-20 sm:px-8 sm:pb-24 sm:pt-28">
						<div className="max-w-3xl">
							<p className="font-mono text-sm uppercase tracking-[0.18em] text-honey">Open source · MIT licensed</p>
							<h1 className="mt-5 font-display text-5xl font-bold leading-[1.02] text-wax sm:text-7xl">
								Coordination for AI coding agents.
							</h1>
							<p className="mt-7 max-w-2xl text-lg leading-relaxed text-kumo-subtle sm:text-xl">
								Hive helps multiple coding agents work on one codebase at the same time. It gives each change its own workspace, checks for collisions, and brings changes together through a shared queue with tests, review, and a recorded decision.
							</p>
							<div className="mt-9 flex flex-wrap gap-3">
								<LinkButton href={GITHUB} variant="primary" size="lg" icon={ArrowUpRightIcon}>
									Explore the project
								</LinkButton>
								<LinkButton href={GUIDE} variant="secondary" size="lg">
									Run your own Hive
								</LinkButton>
							</div>
						</div>
						<div className="mt-12 max-w-3xl border-l-2 border-honey/60 pl-4 text-sm leading-relaxed text-kumo-subtle">
							{selfHosted
								? "This Hive runs on infrastructure you control. Writes require the owner access token; keep it private."
								: "This website is a static project page. We do not host Hive instances, provide accounts, or run agents for visitors. You run Hive locally or deploy your own instance and control its infrastructure and usage."}
						</div>
					</div>
				</section>

				<section className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24" aria-label="What Hive is">
					<SectionHeading
						eyebrow="What Hive is"
						title="A coordination layer for changes made in parallel."
						copy="Git is good at storing code. Hive adds a workflow for many agents changing that code at once: goals describe the work, isolated changes keep attempts apart, and a convergence queue checks what is ready to land. Trunk remains ordinary Git."
					/>
					<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{features.map((feature) => (
							<article key={feature.number} className="cut-sm border border-comb-line bg-comb/40 p-6 sm:p-7">
								<p className="font-mono text-xs text-honey">{feature.number} / FEATURE</p>
								<h3 className="mt-4 font-display text-xl font-semibold text-wax">{feature.title}</h3>
								<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">{feature.copy}</p>
							</article>
						))}
					</div>
					<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-comb-line pt-6 text-sm text-kumo-subtle">
						<span>Use it with MCP-compatible agents, the Hive CLI, or its dashboard.</span>
						<a href={`${GITHUB}#ways-in-dashboard-mcp-cli-git`} className="inline-flex items-center gap-1 text-honey hover:underline">
							See how it works <ArrowUpRightIcon size={15} />
						</a>
					</div>
				</section>

				<section id="use-cases" className="border-y border-white/5 bg-comb/20">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
						<SectionHeading
							eyebrow="What it is used for"
							title="Give a swarm useful work, with a way to stay in control."
							copy="Hive is for developers and teams experimenting with agent-driven software work, from a few concurrent tasks to larger batches that need review and traceability."
						/>
						<div className="mt-10 grid gap-8 md:grid-cols-3">
							{useCases.map((item, index) => (
								<article key={item.title} className="border-t border-honey/40 pt-5">
									<p className="font-mono text-xs text-steel">USE CASE 0{index + 1}</p>
									<h3 className="mt-3 font-display text-xl font-semibold text-wax">{item.title}</h3>
									<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">{item.copy}</p>
								</article>
							))}
						</div>
					</div>
				</section>

				<section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
					<SectionHeading
						eyebrow="Built into the workflow"
						title="People can inspect, guide, and learn from every attempt."
						copy="Hive keeps people involved where judgment matters and makes the path from goal to code visible."
					/>
					<div className="mt-10 grid gap-4 md:grid-cols-2">
						<div className="cut-sm border border-comb-line bg-comb/40 p-6 sm:p-8">
							<h3 className="font-display text-xl font-semibold text-wax">Review and steer</h3>
							<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">Comment on a diff, steer an active agent, retry with another model, or rewind an attempt to an earlier step. Changes that need judgment can wait for a person.</p>
						</div>
						<div className="cut-sm border border-comb-line bg-comb/40 p-6 sm:p-8">
							<h3 className="font-display text-xl font-semibold text-wax">Trace decisions and costs</h3>
							<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">Follow a line back to its change and goal, inspect the checks and decision, and review model usage and budgets for your own instance.</p>
						</div>
					</div>
					<p className="mt-6 text-xs leading-relaxed text-steel">Hive is an open-source project. Features that use models or cloud infrastructure run only in an instance you operate and may incur charges from your chosen providers.</p>
				</section>

				<section id="roadmap" className="border-y border-white/5 bg-comb/20">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
						<div className="flex flex-wrap items-end justify-between gap-5">
							<SectionHeading
								eyebrow="Roadmap"
								title="What the project is working toward."
								copy="The roadmap tracks the next areas of development. Progress can change as the project evolves."
							/>
							<a href={ROADMAP} className="inline-flex items-center gap-1 pb-1 text-sm text-honey hover:underline">
								Full roadmap <ArrowUpRightIcon size={15} />
							</a>
						</div>
						<div className="mt-10 grid gap-4 md:grid-cols-2">
							{roadmap.map((item) => (
								<article key={item.title} className="cut-sm border border-comb-line bg-night/70 p-6 sm:p-7">
									<div className="flex items-start justify-between gap-4">
										<h3 className="font-display text-lg font-semibold text-wax">{item.title}</h3>
										<span className="shrink-0 font-mono text-xs text-honey">{item.progress}%</span>
									</div>
									<div className="mt-4 h-1 overflow-hidden bg-comb-line" role="img" aria-label={`${item.progress}% roadmap progress`}>
										<div className="h-full bg-honey" style={{ width: `${item.progress}%` }} />
									</div>
									<p className="mt-4 text-sm leading-relaxed text-kumo-subtle">{item.copy}</p>
								</article>
							))}
						</div>
					</div>
				</section>

				<section id="contribute" className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
					<div className="cut border border-honey/30 bg-comb/40 p-7 sm:p-10">
						<div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
							<div className="max-w-2xl">
								<SectionHeading
									eyebrow="Contributions welcome"
									title="Help make agent coordination better."
									copy="Explore the code, try Hive with a repository you control, report an issue, improve the docs, or propose a focused change. Contributions are released under the MIT license."
								/>
							</div>
							<div className="flex flex-wrap gap-3">
								<LinkButton href={CONTRIBUTING} variant="primary" size="lg" icon={ArrowUpRightIcon}>
									Contribution guide
								</LinkButton>
								<LinkButton href={`${GITHUB}/issues`} variant="secondary" size="lg">
									Browse issues
								</LinkButton>
							</div>
						</div>
						<div className="mt-8 border-t border-comb-line pt-5 text-sm text-kumo-subtle">
							New to the project? Start with the <a href={GUIDE} className="text-honey hover:underline">self-hosting guide</a> and the <a href={GITHUB} className="text-honey hover:underline">README</a>.
						</div>
					</div>
				</section>
			</main>

			<footer className="border-t border-white/5 px-4 py-8 sm:px-8">
				<div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-kumo-subtle sm:flex-row sm:items-center">
					<Wordmark />
					<p>Open source under the MIT license.</p>
					<div className="flex flex-wrap gap-4 sm:ml-auto">
						<a href={GITHUB} className="hover:text-wax">GitHub</a>
						<a href={`${GITHUB}/blob/main/LICENSE`} className="hover:text-wax">License</a>
						<a href={GUIDE} className="hover:text-wax">Self-hosting</a>
						<a href={ROADMAP} className="hover:text-wax">Roadmap</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
