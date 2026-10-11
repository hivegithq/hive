import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Radio } from "@cloudflare/kumo/components/radio";
import { Select } from "@cloudflare/kumo/components/select";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { CopyIcon, DownloadSimpleIcon, GitBranchIcon, GitCommitIcon, PlusIcon, ShieldCheckIcon, TerminalWindowIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useMemo, useState } from "react";
import type { Change, ChangeStatus, Overlap } from "../../domain/types.ts";
import { api, type LogLine, MODELS, modelLabel, type Snapshot, type TrunkCommit, useHive } from "../api.ts";
import { HiveMap, MAP_GROUPS, type MapGroup } from "../hex/HiveMap.tsx";
import { PlanGraph } from "../hex/PlanGraph.tsx";
import { Wordmark } from "../ui/Logo.tsx";
import { RepoForm } from "../ui/RepoForm.tsx";
import { VERSION } from "../version.ts";
import { ChangeCard } from "./ChangeCard.tsx";
import { ChangeDrawer } from "./ChangeDrawer.tsx";
import { ChecksPanel } from "./ChecksPanel.tsx";

const CARDS_PER_STAGE = 60;

// Stages follow a change from fork to trunk; each is one group on the Hive map.
const STAGES: { id: MapGroup; title: string; hint: string; statuses: ChangeStatus[] }[] = [
	{ id: "working", title: "Working", hint: "Agents editing in their own forks.", statuses: ["drafting", "bounced"] },
	{ id: "queued", title: "In queue", hint: "Waiting for a batch. Changes that touch nothing anyone else touches go first.", statuses: ["submitted", "evaluated"] },
	{ id: "converging", title: "Converging", hint: "Stacked on trunk with the rest of their batch: tests, review, decision.", statuses: ["converging"] },
	{ id: "attention", title: "Needs you", hint: "Clef wasn't sure, or a change kept failing. A person decides.", statuses: ["escalated"] },
	{ id: "landed", title: "Landed", hint: "On trunk, with a record of why.", statuses: ["landed"] },
];

export function Dashboard({ repo }: { repo: string }) {
	const hive = useHive(repo);
	const [selected, setSelected] = useState<string | null>(null);
	const [panel, setPanel] = useState<"checks" | "import" | null>(null);
	const { snapshot } = hive;

	if (!snapshot) {
		return (
			<main className="grid min-h-screen place-items-center bg-night">
				<div className="flex flex-col items-center gap-4 text-kumo-subtle">
					<Loader size="lg" />
					<p>{hive.error ?? `Connecting to ${repo}`}</p>
				</div>
			</main>
		);
	}

	return (
		<div className="min-h-screen bg-night pb-14">
			<TopBar repo={repo} snapshot={snapshot} connected={hive.connected} trunkHead={hive.trunk[0]?.hash} onPanel={setPanel} />
			<div className="grid gap-px bg-white/5 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
				<GoalRail repo={repo} snapshot={snapshot} />
				<main className="min-w-0 bg-night">
					<Overview snapshot={snapshot} />
					<PlanPanel snapshot={snapshot} log={hive.log} onSelect={setSelected} />
					<Stages snapshot={snapshot} overlaps={hive.overlaps} selected={selected} onSelect={setSelected} />
				</main>
				<TrunkColumn trunk={hive.trunk} onSelect={setSelected} />
			</div>
			<Ticker log={hive.log} />
			<AnimatePresence>
				{selected && <ChangeDrawer key={selected} repo={repo} changeId={selected} tick={hive.tick} onClose={() => setSelected(null)} />}
				{panel === "checks" && <ChecksPanel key="checks" repo={repo} onClose={() => setPanel(null)} />}
			</AnimatePresence>
			<Dialog.Root open={panel === "import"} onOpenChange={(open) => setPanel(open ? "import" : null)}>
				<Dialog className="w-[min(560px,calc(100vw-2rem))] bg-[#141417] p-6 ring-1 ring-honey/35">
					<div className="mb-5 flex items-start justify-between gap-4">
						<Dialog.Title className="font-display text-2xl font-semibold text-wax">Add a repository</Dialog.Title>
						<Dialog.Close aria-label="Close" render={(props) => <Button {...props} variant="ghost" shape="square" icon={XIcon} aria-label="Close" />} />
					</div>
					<RepoForm />
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

function countsOf(snapshot: Snapshot): Record<ChangeStatus, number> {
	if (snapshot.counts) return snapshot.counts as Record<ChangeStatus, number>;
	const out = {} as Record<ChangeStatus, number>;
	for (const c of snapshot.changes) out[c.status] = (out[c.status] ?? 0) + 1;
	return out;
}

const groupCounts = (snapshot: Snapshot): Record<MapGroup, number> => {
	const c = countsOf(snapshot);
	return Object.fromEntries(STAGES.map((s) => [s.id, s.statuses.reduce((n, st) => n + (c[st] ?? 0), 0)])) as Record<MapGroup, number>;
};

function TopBar(props: { repo: string; snapshot: Snapshot; connected: boolean; trunkHead?: string; onPanel: (p: "checks" | "import") => void }) {
	const g = groupCounts(props.snapshot);
	const inFlight = g.working + g.queued + g.converging + g.attention;
	const [clone, setClone] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	return (
		<header className="sticky top-0 z-30 border-b border-white/5 bg-night/80 backdrop-blur-md">
			<div className="flex h-14 items-center gap-4 px-4">
				<Wordmark />
				<span className="text-white/15">/</span>
				<h1 className="font-display text-lg font-semibold text-wax">{props.repo}</h1>
				<Badge variant={props.connected ? "success" : "warning"} appearance="dot">
					{props.connected ? "Live" : "Reconnecting"}
				</Badge>
				<p className="ml-2 hidden gap-5 text-sm text-kumo-subtle lg:flex">
					<span>
						<span className="tabular text-wax">{inFlight.toLocaleString()}</span> in flight
					</span>
					<span>
						<span className="tabular text-wax">{props.snapshot.intents.length.toLocaleString()}</span> live intents
					</span>
					{props.trunkHead && (
						<span className="flex items-center gap-1">
							<GitBranchIcon size={14} /> trunk at <span className="font-mono text-wax">{props.trunkHead.slice(0, 8)}</span>
						</span>
					)}
				</p>
				<span className="ml-auto hidden font-mono text-xs text-kumo-subtle md:inline">v{VERSION}</span>
				<Button variant="ghost" size="sm" icon={DownloadSimpleIcon} onClick={() => props.onPanel("import")}>
					<span className="hidden sm:inline">Import</span>
				</Button>
				<Button variant="secondary" size="sm" icon={ShieldCheckIcon} onClick={() => props.onPanel("checks")}>
					<span className="hidden sm:inline">Checks & settings</span>
				</Button>
				<Button variant="secondary" size="sm" icon={TerminalWindowIcon} onClick={() => api.clone(props.repo).then((r) => setClone(r.command))}>
					Clone with git
				</Button>
			</div>
			<AnimatePresence>
				{clone && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						className="overflow-hidden border-t border-white/5"
						role="dialog"
						aria-label="Clone command"
					>
						<div className="flex items-center gap-3 px-4 py-3">
							<p className="shrink-0 text-sm text-kumo-subtle">Works with any git client for the next hour:</p>
							<code className="min-w-0 flex-1 truncate font-mono text-xs text-honey">{clone}</code>
							<Button
								variant="ghost"
								size="sm"
								icon={CopyIcon}
								onClick={() => navigator.clipboard.writeText(clone).then(() => setCopied(true), () => {})}
							>
								{copied ? "Copied" : "Copy"}
							</Button>
							<Button variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close" onClick={() => (setClone(null), setCopied(false))} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</header>
	);
}

function Overview({ snapshot }: { snapshot: Snapshot }) {
	const g = groupCounts(snapshot);
	const total = Object.values(g).reduce((a, b) => a + b, 0);
	return (
		<section className="comb-bg relative border-b border-white/5" aria-label="Hive map">
			<HiveMap counts={g} className="h-[340px] w-full sm:h-[420px]" />
			<div className="pointer-events-none absolute left-4 top-4 sm:left-6 sm:top-6">
				<p className="font-display text-4xl font-semibold text-wax tabular">{total.toLocaleString()}</p>
				<p className="text-sm text-kumo-subtle">changes in this hive</p>
			</div>
			<ul className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm sm:left-6">
				{MAP_GROUPS.map((m) => (
					<li key={m.id} className="flex items-center gap-1.5">
						<svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true">
							<polygon points="6,0.5 11.5,3.5 11.5,9.5 6,12.5 0.5,9.5 0.5,3.5" fill={`rgba(${m.rgb.join(",")},${m.fill})`} stroke={`rgba(${m.rgb.join(",")},${m.stroke})`} />
						</svg>
						<span className="text-kumo-subtle">{m.label}</span>
						<span className="tabular text-wax">{g[m.id].toLocaleString()}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

// The latest planned goal: the planner at work, then its sub-goals as a dependency graph.
function PlanPanel({ snapshot, log, onSelect }: { snapshot: Snapshot; log: LogLine[]; onSelect: (changeId: string) => void }) {
	const parent = [...snapshot.goals].reverse().find((g) => g.status === "planning" || snapshot.goals.some((c) => c.parentId === g.id));
	if (!parent) return null;
	const children = snapshot.goals.filter((g) => g.parentId === parent.id);
	const done = children.filter((c) => c.status === "achieved").length;
	// A sub-goal opens its newest change.
	const changeFor = (goalId: string) => snapshot.changes.filter((c) => c.goalId === goalId).sort((a, b) => b.createdAt - a.createdAt)[0]?.id;
	const plannerLines = log.filter((l) => l.agentId.startsWith("p-")).slice(-4);
	return (
		<section className="border-b border-white/5 p-4 sm:p-6" aria-label="Plan">
			<div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<h2 className="font-display text-lg font-semibold text-wax">Plan</h2>
				<p className="min-w-0 truncate text-sm text-kumo-default">“{parent.title}”</p>
				{children.length > 0 && (
					<p className="text-sm text-kumo-subtle sm:ml-auto">
						<span className="tabular text-honey">{done}</span> of <span className="tabular">{children.length}</span> sub-goals landed. Click one to open it.
					</p>
				)}
			</div>
			{parent.status === "planning" && children.length === 0 ? (
				<div className="flex items-start gap-4">
					<svg width="34" height="38" viewBox="0 0 34 38" className="animate-pulse-flare shrink-0" aria-hidden="true">
						<polygon points="17,1 33,10 33,28 17,37 1,28 1,10" fill="rgba(246,130,31,0.25)" stroke="#f6821f" strokeWidth="1.5" />
					</svg>
					<div className="min-w-0">
						<p className="text-kumo-default">The planner is reading the code and splitting the goal into sub-goals.</p>
						<ul className="mt-2 space-y-0.5 font-mono text-xs text-kumo-subtle">
							{plannerLines.length ? plannerLines.map((l) => <li key={`${l.at}${l.text}`}>{l.text}</li>) : <li>starting</li>}
						</ul>
					</div>
				</div>
			) : (
				<PlanGraph
					goals={children}
					deps={snapshot.goalDeps ?? []}
					onSelect={(goalId) => {
						const id = changeFor(goalId);
						if (id) onSelect(id);
					}}
				/>
			)}
		</section>
	);
}

function Stages(props: { snapshot: Snapshot; overlaps: Record<string, Overlap[]>; selected: string | null; onSelect: (id: string) => void }) {
	const { snapshot } = props;
	const g = groupCounts(snapshot);
	const busiest = (["attention", "converging", "queued", "working", "landed"] as MapGroup[]).find((id) => g[id] > 0) ?? "working";
	const [picked, setPicked] = useState<MapGroup | null>(null);
	const stageId = picked ?? busiest;
	const stage = STAGES.find((s) => s.id === stageId)!;

	const goals = useMemo(() => new Map(snapshot.goals.map((x) => [x.id, x])), [snapshot.goals]);
	const intents = useMemo(() => new Map(snapshot.intents.map((i) => [i.changeId, i])), [snapshot.intents]);
	const queue = useMemo(() => new Map(snapshot.queue.map((q) => [q.changeId, q.position])), [snapshot.queue]);
	const agentToChange = useMemo(() => new Map(snapshot.changes.map((c) => [c.agentId, c.id])), [snapshot.changes]);

	const changes: Change[] = snapshot.changes
		.filter((c) => stage.statuses.includes(c.status))
		.sort((a, b) => (queue.get(a.id) ?? 1e9) - (queue.get(b.id) ?? 1e9) || b.updatedAt - a.updatedAt);
	const shown = changes.slice(0, CARDS_PER_STAGE);
	const total = g[stage.id];

	return (
		<section className="p-4 sm:p-6" aria-label="Changes by stage">
			<Tabs
				variant="underline"
				value={stageId}
				onValueChange={(v) => setPicked(v as MapGroup)}
				tabs={STAGES.map((s) => ({
					value: s.id,
					label: (
						<span className="flex items-center gap-2">
							{s.title}
							<span className={`tabular text-xs ${s.id === "attention" && g[s.id] ? "text-alarm" : "text-kumo-subtle"}`}>{g[s.id].toLocaleString()}</span>
						</span>
					),
				}))}
			/>
			<p className="mb-5 mt-4 text-sm text-kumo-subtle">{stage.hint}</p>
			{shown.length === 0 ? (
				<Empty title={`Nothing ${stage.title.toLowerCase()}`} description={stage.id === "working" ? "Start an agent on a goal from the panel on the left." : "Changes show up here as they move through the hive."} />
			) : (
				<motion.ul layout className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
					<AnimatePresence initial={false}>
						{shown.map((c) => (
							<li key={c.id}>
								<ChangeCard
									change={c}
									goal={goals.get(c.goalId)}
									intent={intents.get(c.id)}
									overlaps={c.status === "landed" ? [] : (props.overlaps[c.id] ?? [])}
									queuePosition={queue.get(c.id) ?? null}
									agentLabel={(agentId) => agentToChange.get(agentId) ?? agentId}
									selected={props.selected === c.id}
									onSelect={() => props.onSelect(c.id)}
								/>
							</li>
						))}
					</AnimatePresence>
				</motion.ul>
			)}
			{total > shown.length && <p className="mt-4 text-sm text-kumo-subtle">and {(total - shown.length).toLocaleString()} more, all on the map above.</p>}
		</section>
	);
}

function GoalRail({ repo, snapshot }: { repo: string; snapshot: Snapshot }) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [mode, setMode] = useState<"one" | "race" | "plan">("one");
	const [parallel, setParallel] = useState(6);
	const [models, setModels] = useState<string[]>([MODELS[0].id, MODELS[1].id, MODELS[2].id]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const goal = await api.createGoal(repo, title, description);
			if (mode === "one") await api.assign(repo, goal.id, models[0]);
			else if (mode === "plan") await api.plan(repo, goal.id, { agentModel: models[0], maxParallel: parallel });
			else await api.race(repo, goal.id, models);
			setTitle("");
			setDescription("");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const toggle = (id: string) => setModels((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
	const label = (m: (typeof MODELS)[number]) => (m.paid ? m.label : `${m.label} (free tier)`);

	return (
		<aside className="space-y-8 bg-night p-5" aria-label="Goals">
			<form onSubmit={submit} className="space-y-4">
				<h2 className="font-display text-lg font-semibold text-wax">New goal</h2>
				<Input label="What should change?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Free shipping on orders over $50" required minLength={3} />
				<InputArea label="Details for the agent" value={description} onValueChange={setDescription} placeholder="Acceptance criteria, edge cases, files to look at" minRows={3} />
				<Radio.Group legend="Who works on it" value={mode} onValueChange={(v) => setMode(v as "one" | "race" | "plan")}>
					<Radio.Item label="One agent" value="one" />
					<Radio.Item label="A race between models" value="race" />
					<Radio.Item label="Plan it first: break it into sub-goals for many agents" value="plan" />
				</Radio.Group>
				{mode === "race" ? (
					<Checkbox.Group legend="Models in the race">
						{MODELS.map((m) => (
							<Checkbox key={m.id} label={label(m)} checked={models.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
						))}
					</Checkbox.Group>
				) : (
					<Select
						label={mode === "plan" ? "Model for the agents" : "Model"}
						value={models[0]}
						onValueChange={(v) => v && setModels([v as string, ...models.filter((m) => m !== v)])}
						items={Object.fromEntries(MODELS.map((m) => [m.id, label(m)]))}
					/>
				)}
				{mode === "plan" && (
					<Input
						label="Agents at once"
						type="number"
						min={1}
						max={32}
						value={String(parallel)}
						onChange={(e) => setParallel(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
						description="Sub-goals start as the ones they depend on land, up to this many at a time."
					/>
				)}
				<Button type="submit" variant="primary" icon={PlusIcon} loading={busy} disabled={mode === "race" && models.length < 2} className="w-full justify-center">
					{mode === "race" ? `Start a ${models.length}-way race` : mode === "plan" ? "Plan it" : "Start an agent"}
				</Button>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
			</form>

			<section>
				<h2 className="mb-3 font-display text-lg font-semibold text-wax">Goals</h2>
				{snapshot.goals.length === 0 ? (
					<p className="text-sm text-kumo-subtle">No goals yet. Describe a change above and an agent will fork the repo and start.</p>
				) : (
					<GoalTree goals={snapshot.goals} />
				)}
			</section>
		</aside>
	);
}

const GOAL_TONE: Record<string, string> = { achieved: "text-honey", planning: "text-flare", planned: "text-flare", racing: "text-flare" };

// Goals newest first, with a planned goal's sub-goals nested under it.
function GoalTree({ goals }: { goals: Snapshot["goals"] }) {
	const children = new Map<string, Snapshot["goals"]>();
	for (const g of goals) if (g.parentId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g]);
	const top = goals.filter((g) => !g.parentId || !goals.some((p) => p.id === g.parentId)).reverse().slice(0, 40);
	const row = (g: Snapshot["goals"][number], nested: boolean) => (
		<li key={g.id} className={`flex items-baseline gap-2 text-sm ${nested ? "border-l border-white/10 pl-3" : ""}`}>
			<span className={`min-w-0 flex-1 truncate ${nested ? "text-kumo-subtle" : "text-kumo-default"}`}>{g.title}</span>
			<span className={`shrink-0 ${GOAL_TONE[g.status] ?? "text-kumo-subtle"}`}>{g.status.replace("_", " ")}</span>
		</li>
	);
	return (
		<ol className="space-y-1.5">
			{top.map((g) => {
				const kids = children.get(g.id) ?? [];
				const done = kids.filter((k) => k.status === "achieved").length;
				return (
					<li key={g.id}>
						<ol className="space-y-1.5">
							{row(g, false)}
							{kids.length > 0 && (
								<li className="pl-3 text-xs text-kumo-subtle">
									{done} of {kids.length} sub-goals landed
								</li>
							)}
							{kids.map((k) => row(k, true))}
						</ol>
					</li>
				);
			})}
		</ol>
	);
}

function TrunkColumn({ trunk, onSelect }: { trunk: TrunkCommit[]; onSelect: (id: string) => void }) {
	return (
		<aside className="bg-night p-5" aria-label="Trunk history">
			<h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-wax">
				<GitCommitIcon size={20} className="text-honey" /> Trunk
			</h2>
			{trunk.length === 0 ? (
				<p className="text-sm text-kumo-subtle">Trunk is empty. Push a first commit with git, or seed the demo repo.</p>
			) : (
				<ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-honey/25">
					<AnimatePresence initial={false}>
						{trunk.map((c) => {
							const changeId = c.trailers["Hive-Change-Id"];
							return (
								<motion.li key={c.hash} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative pl-6">
									<svg width="11" height="12" viewBox="0 0 11 12" className="absolute left-0 top-1" aria-hidden="true">
										<polygon points="5.5,0.5 10.5,3.2 10.5,8.8 5.5,11.5 0.5,8.8 0.5,3.2" fill={changeId ? "#fbad41" : "#0d0d0f"} stroke="#fbad41" />
									</svg>
									<p className="line-clamp-2 text-sm leading-snug text-kumo-default">{c.message.split("\n")[0]}</p>
									<p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-kumo-subtle">
										<span className="font-mono">{c.hash.slice(0, 7)}</span>
										{changeId ? (
											<button type="button" className="text-honey hover:underline" onClick={() => onSelect(changeId)}>
												{changeId} · {c.trailers["Hive-Model"] === "sim" ? "simulated" : modelLabel(c.trailers["Hive-Model"] ?? "")}
											</button>
										) : (
											<span>pushed by {c.author.name}</span>
										)}
									</p>
								</motion.li>
							);
						})}
					</AnimatePresence>
				</ol>
			)}
		</aside>
	);
}

function Ticker({ log }: { log: LogLine[] }) {
	const latest = log.at(-1);
	return (
		<footer className="fixed inset-x-0 bottom-0 z-20 flex h-11 items-center gap-3 overflow-hidden border-t border-white/5 bg-night/90 px-4 text-sm backdrop-blur-md" aria-live="polite">
			<span className="relative flex h-2 w-2 shrink-0">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-honey opacity-60" />
				<span className="relative inline-flex h-2 w-2 rounded-full bg-honey" />
			</span>
			<AnimatePresence mode="wait">
				{latest ? (
					<motion.p key={`${latest.at}-${latest.agentId}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="truncate">
						<span className="font-mono text-xs text-honey">{latest.agentId}</span> <span className="text-kumo-default">{latest.text}</span>
					</motion.p>
				) : (
					<p className="text-kumo-subtle">Agent activity shows up here as it happens.</p>
				)}
			</AnimatePresence>
		</footer>
	);
}
