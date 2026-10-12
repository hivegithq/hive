import { useEffect, useState } from "react";

// Hive-wide numbers from /api/hive/stats (summed across the showcase repositories, cached a minute).
export interface RepoSummary {
	repo: string;
	changes: number;
	landed: number;
	aiChanges: number;
	aiLanded: number;
	models: string[];
	goals: number;
	plans: number;
	batches: number;
	checks: { commit: string; at: number; ok: boolean; languages: string[]; source: string; runs: { kind: string; command: string; ok: boolean }[] } | null;
}

export interface HiveStats {
	repos: RepoSummary[];
	totals: { repos: number; changes: number; landed: number; aiChanges: number; aiLanded: number; goals: number; plans: number; batches: number; models: string[]; languages: string[] };
	at: number;
}

export function useHiveStats(refreshMs = 60_000) {
	const [stats, setStats] = useState<HiveStats | null>(null);
	useEffect(() => {
		let stop = false;
		const load = () =>
			fetch("/api/hive/stats")
				.then((r) => (r.ok ? (r.json() as Promise<HiveStats>) : null))
				.then((s) => !stop && s && setStats(s))
				.catch(() => {});
		load();
		const t = setInterval(load, refreshMs);
		return () => {
			stop = true;
			clearInterval(t);
		};
	}, [refreshMs]);
	return stats;
}
