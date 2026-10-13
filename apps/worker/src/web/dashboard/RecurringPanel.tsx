import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { api, MODELS, modelLabel, type Recurring, useModels } from "../api.ts";

const inMinutes = (t: number) => {
	const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
	return m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

// Goals that come back on a schedule, such as a nightly "fix new lint warnings". Each run is an
// ordinary goal, skipped when the previous run is still going.
export function RecurringPanel({ repo, canWrite }: { repo: string; canWrite: boolean }) {
	const [list, setList] = useState<Recurring[] | null>(null);
	const [title, setTitle] = useState("");
	const [every, setEvery] = useState("daily");
	const models = useModels(true);
	const [model, setModel] = useState(MODELS[0].id);
	const [budget, setBudget] = useState("1");
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (canWrite) api.recurring(repo).then(setList, (e) => setError(e.message));
	}, [repo, canWrite]);

	const add = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api.addRecurring(repo, { title: title.trim(), every, models: [model], budget: Number(budget) > 0 ? Number(budget) : undefined });
			setTitle("");
			setList(await api.recurring(repo));
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	if (!canWrite) return null;
	return (
		<section className="space-y-3">
			<h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-honey">
				<ArrowsClockwiseIcon size={16} /> Recurring goals
			</h3>
			<p className="text-sm text-kumo-subtle">A goal that comes back on a schedule, with one agent. A run is skipped while the last one is still going.</p>
			{list?.map((r) => (
				<div key={r.id} className="cut-sm space-y-1 bg-black/30 p-3 text-sm ring-1 ring-white/5">
					<p className="text-kumo-default">{r.title}</p>
					<p className="text-xs text-kumo-subtle">
						{r.every} · {r.models[0] ? modelLabel(r.models[0]) : "default model"}
						{r.budget ? ` · $${r.budget} a run` : ""} · {r.runs} run{r.runs === 1 ? "" : "s"} · {r.enabled ? `next in ${inMinutes(r.nextRun)}` : "paused"}
					</p>
					<div className="flex gap-2 pt-1">
						<Button
							size="sm"
							variant="secondary"
							onClick={async () => {
								const x: { skipped: boolean; reason?: string; goalId?: string } = await api.runRecurring(repo, r.id).catch((e: Error) => ({ skipped: true, reason: e.message }));
								setNote(x.skipped ? `Skipped: ${x.reason}` : `Started ${x.goalId}.`);
								setList(await api.recurring(repo));
							}}
						>
							Run now
						</Button>
						<Button size="sm" variant="ghost" onClick={async () => setList(await api.setRecurring(repo, r.id, { enabled: !r.enabled }))}>
							{r.enabled ? "Pause" : "Resume"}
						</Button>
						<Button size="sm" variant="ghost" onClick={async () => setList(await api.setRecurring(repo, r.id, { remove: true }))}>
							Remove
						</Button>
					</div>
				</div>
			))}
			{note && <p className="text-sm text-kumo-default">{note}</p>}
			<form onSubmit={add} className="space-y-2">
				<Input label="Goal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix new lint warnings" required minLength={3} />
				<div className="grid grid-cols-3 gap-2">
					<Input label="Every" value={every} onChange={(e) => setEvery(e.target.value)} placeholder="daily, 6h, weekly" />
					<Input label="USD a run" type="number" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />
					<Select label="Model" value={model} onValueChange={(v) => v && setModel(v as string)} items={Object.fromEntries(models.map((m) => [m.id, m.label]))} />
				</div>
				<Button type="submit" variant="secondary" loading={busy} disabled={title.trim().length < 3}>
					Add
				</Button>
			</form>
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
		</section>
	);
}
