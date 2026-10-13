import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { PlusIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { api, MODELS, modelLabel, useModels } from "../api.ts";

type Mode = "one" | "race" | "plan";

// The three ways to put agents on a goal. Each says what will happen, in a line.
const MODES: { id: Mode; title: string; line: string; cells: number }[] = [
	{ id: "one", title: "One agent", line: "One model forks trunk and writes the change. It lands when the checks pass and Clef agrees.", cells: 1 },
	{ id: "race", title: "Race models", line: "Several models try the same goal at once, each in its own fork. The best evidence wins, or you pick.", cells: 3 },
	{ id: "plan", title: "Plan and split", line: "A planner breaks a big goal into sub-goals. Agents work on them in parallel as dependencies land.", cells: 6 },
];

const PLANNERS = MODELS.filter((m) => m.paid);
const DEFAULT_PLANNER = "@cf/zai-org/glm-5.3";
const label = (m: { label: string; paid: boolean; byo?: boolean }) => (m.paid || m.byo ? m.label : `${m.label} (free tier)`);

// A small honeycomb: how many agents a mode puts to work.
function Cells({ n, on }: { n: number; on: boolean }) {
	return (
		<svg viewBox="0 0 36 20" className="h-5 w-9 shrink-0" aria-hidden="true">
			{Array.from({ length: n }, (_, i) => {
				const x = 5 + (i % 3) * 11 + (Math.floor(i / 3) % 2) * 5.5;
				const y = 5.5 + Math.floor(i / 3) * 9;
				const p = [0, 1, 2, 3, 4, 5].map((k) => {
					const a = (Math.PI / 3) * k + Math.PI / 6;
					return `${x + 4.6 * Math.cos(a)},${y + 4.6 * Math.sin(a)}`;
				});
				return <polygon key={i} points={p.join(" ")} className={on ? "fill-honey" : "fill-white/20"} />;
			})}
		</svg>
	);
}

export function GoalComposer({ repo }: { repo: string }) {
	const choices = useModels(); // a few of the endpoint's, for the lists of checkboxes
	const allChoices = useModels(true); // everything, for a single choice
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [mode, setMode] = useState<Mode>("one");
	const [model, setModel] = useState(MODELS[0].id);
	const [racers, setRacers] = useState<string[]>([MODELS[0].id, MODELS[2].id, MODELS[3].id]);
	const [planner, setPlanner] = useState(DEFAULT_PLANNER);
	const [crew, setCrew] = useState<string[]>([MODELS[0].id]);
	const [parallel, setParallel] = useState(6);
	const [scouts, setScouts] = useState(true);
	const [budget, setBudget] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	const ready = mode === "race" ? racers.length >= 2 : mode === "plan" ? crew.length >= 1 : true;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		let goalId: string | null = null;
		try {
			goalId = (await api.createGoal(repo, title, description, Number(budget) > 0 ? Number(budget) : undefined)).id;
			if (mode === "one") await api.assign(repo, goalId, model);
			else if (mode === "race") await api.race(repo, goalId, racers);
			else await api.plan(repo, goalId, { model: planner, agentModels: crew, maxParallel: parallel, scouts });
			setTitle("");
			setDescription("");
		} catch (err) {
			const msg = (err as Error).message;
			setError(goalId ? `The goal was created, but no agent started: ${msg}` : msg);
		} finally {
			setBusy(false);
		}
	};

	const action =
		mode === "one" ? `Start ${modelLabel(model)}` : mode === "race" ? `Start a ${racers.length}-model race` : `Plan it with ${modelLabel(planner)}`;

	return (
		<form onSubmit={submit} className="space-y-4">
			<h2 className="font-display text-lg font-semibold text-wax">New goal</h2>
			<Input label="What should change?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Free shipping on orders over $50" required minLength={3} />
			<InputArea label="Details for the agents" value={description} onValueChange={setDescription} placeholder="Acceptance criteria, edge cases, files to look at" minRows={3} />

			<fieldset>
				<legend className="mb-2 text-sm font-medium text-kumo-default">How should agents work on it?</legend>
				<div className="space-y-1.5" role="radiogroup">
					{MODES.map((m) => {
						const on = mode === m.id;
						return (
							<button
								key={m.id}
								type="button"
								role="radio"
								aria-checked={on}
								onClick={() => setMode(m.id)}
								className={`cut-sm flex w-full items-start gap-3 p-3 text-left ring-1 transition-colors ${on ? "bg-honey/10 ring-honey/50" : "bg-white/[0.02] ring-white/10 hover:ring-white/25"}`}
							>
								<Cells n={m.cells} on={on} />
								<span className="min-w-0">
									<span className={`block font-medium ${on ? "text-wax" : "text-kumo-default"}`}>{m.title}</span>
									<span className="mt-0.5 block text-xs leading-relaxed text-kumo-subtle">{m.line}</span>
								</span>
							</button>
						);
					})}
				</div>
			</fieldset>

			{mode === "one" && (
				<Select label="Model" value={model} onValueChange={(v) => v && setModel(v as string)} items={Object.fromEntries(allChoices.map((m) => [m.id, label(m)]))} />
			)}
			{mode === "race" && (
				<Checkbox.Group legend="Models in the race (two or more)">
					{choices.map((m) => (
						<Checkbox key={m.id} label={label(m)} checked={racers.includes(m.id)} onCheckedChange={() => toggle(racers, setRacers, m.id)} />
					))}
				</Checkbox.Group>
			)}
			{mode === "plan" && (
				<>
					<Select
						label="Planner"
						value={planner}
						onValueChange={(v) => v && setPlanner(v as string)}
						items={Object.fromEntries(PLANNERS.map((m) => [m.id, m.id === DEFAULT_PLANNER ? `${m.label} (reads the most code)` : m.label]))}
					/>
					<Checkbox.Group legend="Models for the agents (sub-goals take them in turn)">
						{choices.map((m) => (
							<Checkbox key={m.id} label={label(m)} checked={crew.includes(m.id)} onCheckedChange={() => toggle(crew, setCrew, m.id)} />
						))}
					</Checkbox.Group>
					<Checkbox label="Scout each sub-goal first: a cheap read-only agent briefs the worker" checked={scouts} onCheckedChange={() => setScouts(!scouts)} />
					<Input
						label="Agents at once"
						type="number"
						min={1}
						max={32}
						value={String(parallel)}
						onChange={(e) => setParallel(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
						description="Sub-goals start as the ones they depend on land, up to this many at a time."
					/>
				</>
			)}

			<Input
				label="Budget in USD (optional)"
				type="number"
				min={0}
				step="0.5"
				value={budget}
				onChange={(e) => setBudget(e.target.value)}
				placeholder="No limit"
				description="Agents stop when the goal, with its sub-goals, has spent this much. A person decides what's next."
			/>
			<Button type="submit" variant="primary" icon={PlusIcon} loading={busy} disabled={!ready} className="w-full justify-center">
				{action}
			</Button>
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
			<a href="/docs/dashboard" className="block text-xs text-kumo-subtle underline-offset-4 hover:text-honey hover:underline">
				How goals, races and plans work
			</a>
		</form>
	);
}
