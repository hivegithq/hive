import { type FormEvent, useMemo, useState } from "react";
import type { Change, ChangeStatus } from "../domain/types.ts";
import { api, MODELS, modelLabel, type Snapshot, useHive } from "./api.ts";
import { ChangeDrawer } from "./ChangeDrawer.tsx";
import { Strip } from "./Strip.tsx";

// Bays follow a change from fork to trunk. Archived race losers are counted, not shown.
const BAYS: { id: string; title: string; hint: string; statuses: ChangeStatus[] }[] = [
	{ id: "working", title: "Working", hint: "Agents editing in their own forks", statuses: ["drafting", "bounced"] },
	{ id: "queued", title: "In queue", hint: "Waiting to converge, disjoint changes first", statuses: ["submitted", "evaluated"] },
	{ id: "converging", title: "Converging", hint: "Rebase, tests, review, decision", statuses: ["converging"] },
	{ id: "attention", title: "Needs you", hint: "Clef wasn’t sure", statuses: ["escalated"] },
	{ id: "landed", title: "Landed", hint: "On trunk", statuses: ["landed"] },
];

export function App() {
	const repo = location.pathname.match(/^\/r\/([^/]+)/)?.[1];
	return repo ? <RepoView repo={decodeURIComponent(repo)} /> : <OpenRepo />;
}

function OpenRepo() {
	const [name, setName] = useState("shop");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		try {
			await api.openRepo(name);
			location.assign(`/r/${encodeURIComponent(name)}`);
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	};
	return (
		<main className="open">
			<h1 className="open__title">Hive</h1>
			<p className="open__lede">Version control for many agents at once. Each change gets its own fork, declares what it will touch, and lands only after evidence and a calibrated decision.</p>
			<form className="open__form" onSubmit={submit}>
				<label htmlFor="repo-name">Repository</label>
				<div className="open__row">
					<input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,40}" required />
					<button className="button button--go" disabled={busy}>
						Open repository
					</button>
				</div>
				{error && <p className="form-error">{error}</p>}
			</form>
		</main>
	);
}

function RepoView({ repo }: { repo: string }) {
	const hive = useHive(repo);
	const [selected, setSelected] = useState<string | null>(null);
	const { snapshot } = hive;

	if (!snapshot) {
		return <main className="loading">{hive.error ?? `Connecting to ${repo}`}</main>;
	}

	return (
		<div className={`layout${selected ? " layout--drawer" : ""}`}>
			<Header repo={repo} snapshot={snapshot} connected={hive.connected} trunkHead={hive.trunk[0]?.hash} />
			<GoalRail repo={repo} snapshot={snapshot} />
			<Board snapshot={snapshot} overlaps={hive.overlaps} selected={selected} onSelect={setSelected} />
			<TrunkColumn trunk={hive.trunk} onSelect={setSelected} />
			<Ticker log={hive.log} />
			{selected && <ChangeDrawer repo={repo} changeId={selected} tick={hive.tick} onClose={() => setSelected(null)} />}
		</div>
	);
}

function Header(props: { repo: string; snapshot: Snapshot; connected: boolean; trunkHead?: string }) {
	const active = props.snapshot.changes.filter((c) => !["landed", "archived"].includes(c.status)).length;
	const [clone, setClone] = useState<string | null>(null);
	return (
		<header className="header">
			<h1 className="header__repo">{props.repo}</h1>
			<p className="header__stats">
				<span>{active} changes in flight</span>
				<span>{props.snapshot.intents.length} live intents</span>
				{props.trunkHead && <span>trunk at <span className="hash">{props.trunkHead.slice(0, 8)}</span></span>}
				<span className={props.connected ? "live" : "live live--off"}>{props.connected ? "Live" : "Reconnecting"}</span>
			</p>
			<button type="button" className="button button--quiet" onClick={() => api.clone(props.repo).then((r) => setClone(r.command))}>
				Clone with git
			</button>
			{clone && (
				<div className="clone" role="dialog" aria-label="Clone command">
					<p>Works with any git client for the next hour.</p>
					<code>{clone}</code>
					<button type="button" className="icon-button" onClick={() => setClone(null)} aria-label="Close">
						×
					</button>
				</div>
			)}
		</header>
	);
}

function GoalRail({ repo, snapshot }: { repo: string; snapshot: Snapshot }) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [mode, setMode] = useState<"one" | "race">("one");
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

	return (
		<section className="rail" aria-label="Goals">
			<form className="composer" onSubmit={submit}>
				<h2 className="rail__title">New goal</h2>
				<label htmlFor="goal-title">What should change?</label>
				<input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Free shipping on orders over $50" required minLength={3} />
				<label htmlFor="goal-desc">Details for the agent</label>
				<textarea id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Acceptance criteria, edge cases, files to look at" />
				<fieldset className="segmented">
					<legend>Who works on it</legend>
					<label>
						<input type="radio" name="mode" checked={mode === "one"} onChange={() => setMode("one")} /> One agent
					</label>
					<label>
						<input type="radio" name="mode" checked={mode === "race"} onChange={() => setMode("race")} /> Race several models
					</label>
				</fieldset>
				{mode === "race" ? (
					<fieldset className="models">
						<legend>Models in the race</legend>
						{MODELS.map((m) => (
							<label key={m.id}>
								<input type="checkbox" checked={models.includes(m.id)} onChange={() => toggle(m.id)} /> {m.label}
								{m.paid && <span className="muted small">needs Workers Paid</span>}
							</label>
						))}
					</fieldset>
				) : (
					<label className="models-one">
						Model
						<select value={models[0]} onChange={(e) => setModels([e.target.value, ...models.filter((m) => m !== e.target.value)])}>
							{MODELS.map((m) => (
								<option key={m.id} value={m.id}>
									{m.paid ? `${m.label} (Workers Paid)` : m.label}
								</option>
							))}
						</select>
					</label>
				)}
				<button className="button button--go" disabled={busy || (mode === "race" && models.length < 2)}>
					{mode === "race" ? `Start a ${models.length}-way race` : "Start an agent"}
				</button>
				{error && <p className="form-error">{error}</p>}
			</form>

			<h2 className="rail__title">Goals</h2>
			{snapshot.goals.length === 0 ? (
				<p className="muted">No goals yet. Describe a change above and an agent will fork the repo and start.</p>
			) : (
				<ol className="goals">
					{[...snapshot.goals].reverse().map((g) => (
						<li key={g.id} className={`goal goal--${g.status}`}>
							<span className="goal__title">{g.title}</span>
							<span className="goal__status">{g.status.replace("_", " ")}</span>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function Board(props: {
	snapshot: Snapshot;
	overlaps: Record<string, import("../domain/types.ts").Overlap[]>;
	selected: string | null;
	onSelect: (id: string) => void;
}) {
	const { snapshot } = props;
	const goals = useMemo(() => new Map(snapshot.goals.map((g) => [g.id, g])), [snapshot.goals]);
	const intents = useMemo(() => new Map(snapshot.intents.map((i) => [i.changeId, i])), [snapshot.intents]);
	const queue = useMemo(() => new Map(snapshot.queue.map((q) => [q.changeId, q.position])), [snapshot.queue]);
	const agentToChange = useMemo(() => new Map(snapshot.changes.map((c) => [c.agentId, c.id])), [snapshot.changes]);
	const archived = snapshot.changes.filter((c) => c.status === "archived").length;

	const byBay = (statuses: ChangeStatus[]) =>
		snapshot.changes
			.filter((c) => statuses.includes(c.status))
			.sort((a, b) => (queue.get(a.id) ?? 99) - (queue.get(b.id) ?? 99) || b.updatedAt - a.updatedAt);

	return (
		<main className="board" aria-label="Changes">
			{BAYS.map((bay) => {
				const changes: Change[] = byBay(bay.statuses);
				// "Needs you" only takes space when something is actually waiting on a person.
				if (bay.id === "attention" && changes.length === 0) return null;
				return (
					<section key={bay.id} className={`bay bay--${bay.id}`} aria-labelledby={`bay-${bay.id}`}>
						<header className="bay__header">
							<h2 id={`bay-${bay.id}`}>{bay.title}</h2>
							<span className="bay__count">{changes.length}</span>
						</header>
						<p className="bay__hint">{bay.hint}</p>
						<div className="bay__strips">
							{changes.map((c) => (
								<Strip
									key={c.id}
									change={c}
									goal={goals.get(c.goalId)}
									intent={intents.get(c.id)}
									overlaps={c.status === "landed" ? [] : (props.overlaps[c.id] ?? [])}
									queuePosition={queue.get(c.id) ?? null}
									agentLabel={(agentId) => agentToChange.get(agentId) ?? agentId}
									selected={props.selected === c.id}
									onSelect={() => props.onSelect(c.id)}
								/>
							))}
							{bay.id === "landed" && archived > 0 && <p className="bay__note">{archived} race entries archived</p>}
						</div>
					</section>
				);
			})}
		</main>
	);
}

function TrunkColumn({ trunk, onSelect }: { trunk: import("./api.ts").TrunkCommit[]; onSelect: (id: string) => void }) {
	return (
		<section className="trunk" aria-label="Trunk history">
			<h2 className="rail__title">Trunk</h2>
			{trunk.length === 0 ? (
				<p className="muted">Trunk is empty. Push a first commit with git, or seed the demo repo.</p>
			) : (
				<ol className="trunk__list">
					{trunk.map((c) => {
						const changeId = c.trailers["Hive-Change-Id"];
						const subject = c.message.split("\n")[0];
						return (
							<li key={c.hash} className={`commit${changeId ? "" : " commit--human"}`}>
								<span className="commit__dot" aria-hidden="true" />
								<span className="commit__subject">{subject}</span>
								<span className="commit__meta">
									<span className="hash">{c.hash.slice(0, 7)}</span>
									{changeId ? (
										<button type="button" className="link" onClick={() => onSelect(changeId)}>
											{changeId} by {modelLabel(c.trailers["Hive-Model"] ?? "")}
										</button>
									) : (
										<span>pushed by {c.author.name}</span>
									)}
								</span>
							</li>
						);
					})}
				</ol>
			)}
		</section>
	);
}

function Ticker({ log }: { log: import("./api.ts").LogLine[] }) {
	const recent = log.slice(-6).reverse();
	return (
		<footer className="ticker" aria-label="Agent activity" aria-live="polite">
			{recent.length === 0 ? (
				<span className="muted">Agent activity shows up here as it happens.</span>
			) : (
				recent.map((l) => (
					<span key={`${l.at}-${l.agentId}-${l.text}`} className="ticker__line">
						<span className="ticker__agent">{l.agentId}</span> {l.text}
					</span>
				))
			)}
		</footer>
	);
}
