// How each model has done on one repository: from changes, decisions and recorded spend.

export interface ModelStats {
	model: string;
	started: number;
	landed: number;
	landingRate: number; // landed / finished (landed + archived after a loss or abandon), 0..1
	bounces: number; // times its changes were sent back
	escalations: number; // times its changes waited for a person
	medianMinutesToLand: number | null;
	cost: number; // everything recorded against its changes
	costPerLanded: number | null;
}

export function leaderboard(
	changes: { id: string; model: string; status: string; createdAt: number }[],
	decisions: { changeId: string; outcome: string; createdAt: number }[],
	costByChange: Map<string, number>,
): ModelStats[] {
	const byChange = new Map<string, { outcome: string; createdAt: number }[]>();
	for (const d of decisions) byChange.set(d.changeId, [...(byChange.get(d.changeId) ?? []), d]);
	const groups = new Map<string, typeof changes>();
	for (const c of changes) {
		if (c.model === "sim") continue;
		groups.set(c.model, [...(groups.get(c.model) ?? []), c]);
	}
	const stats: ModelStats[] = [];
	for (const [model, list] of groups) {
		const landed = list.filter((c) => c.status === "landed");
		const finished = list.filter((c) => c.status === "landed" || c.status === "archived").length;
		const ds = list.flatMap((c) => byChange.get(c.id) ?? []);
		const minutes = landed
			.map((c) => {
				const land = (byChange.get(c.id) ?? []).filter((d) => d.outcome === "land" || d.outcome === "win").at(-1);
				return land ? (land.createdAt - c.createdAt) / 60_000 : null;
			})
			.filter((m): m is number => m !== null && m >= 0)
			.sort((a, b) => a - b);
		const cost = list.reduce((n, c) => n + (costByChange.get(c.id) ?? 0), 0);
		stats.push({
			model,
			started: list.length,
			landed: landed.length,
			landingRate: finished ? landed.length / finished : 0,
			bounces: ds.filter((d) => d.outcome === "bounce").length,
			escalations: ds.filter((d) => d.outcome === "escalate").length,
			medianMinutesToLand: minutes.length ? minutes[Math.floor((minutes.length - 1) / 2)] : null,
			cost,
			costPerLanded: landed.length ? cost / landed.length : null,
		});
	}
	return stats.sort((a, b) => b.landed - a.landed || b.landingRate - a.landingRate);
}
