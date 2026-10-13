import { PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { usd } from "../../domain/pricing.ts";
import { Wordmark } from "../ui/Logo.tsx";
import { Account } from "../ui/Account.tsx";

interface Summary {
	repo: string;
	changes: number;
	landed: number;
	aiLanded: number;
	goals: number;
	inFlight: number;
	needsYou: number;
	spend: number;
	lastAt: number;
	models: string[];
	checks: { ok: boolean; languages: string[] } | null;
}

const ago = (t: number) => {
	if (!t) return "no activity yet";
	const m = Math.round((Date.now() - t) / 60_000);
	return m < 1 ? "active just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// Every repository on this deployment, busiest first, with what needs a person.
export function Repos() {
	const [repos, setRepos] = useState<Summary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		document.title = "Repositories · Hive";
		fetch("/api/repos")
			.then((r) => (r.ok ? (r.json() as Promise<Summary[]>) : Promise.reject(new Error(`${r.status}`))))
			.then(setRepos, (e) => setError(e.message));
	}, []);
	const needs = (repos ?? []).reduce((n, r) => n + r.needsYou, 0);
	return (
		<div className="min-h-screen bg-night text-kumo-default">
			<header className="sticky top-0 z-30 border-b border-white/5 bg-night/80 backdrop-blur-md">
				<div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-8">
					<Wordmark />
					<span className="font-display text-sm font-semibold text-kumo-subtle">Repositories</span>
					<div className="ml-auto flex items-center gap-4 text-sm text-kumo-subtle">
						<a href="/docs" className="hover:text-wax">
							Docs
						</a>
						<Account />
					</div>
				</div>
			</header>
			<main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
				<h1 className="font-display text-4xl font-bold text-wax">Repositories</h1>
				<p className="mt-3 max-w-2xl text-kumo-subtle">
					Every repository on this Hive, busiest first.
					{needs > 0 && (
						<>
							{" "}
							<span className="text-alarm">{needs} change{needs === 1 ? "" : "s"} need a person</span>.
						</>
					)}
				</p>
				{error && <p className="mt-6 text-kumo-danger">Couldn't load repositories ({error}).</p>}
				{!repos && !error && <p className="mt-6 text-kumo-subtle">Loading</p>}
				<ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{repos?.map((r) => (
						<li key={r.repo}>
							<a href={`/r/${encodeURIComponent(r.repo)}`} className="cut-sm group block h-full bg-comb/40 p-5 ring-1 ring-comb-line transition hover:ring-honey/50">
								<div className="flex items-baseline gap-2">
									<p className="min-w-0 flex-1 truncate font-display text-xl font-semibold text-wax group-hover:text-honey">{r.repo}</p>
									{r.checks && <span className={`shrink-0 text-xs ${r.checks.ok ? "text-honey" : "text-alarm"}`}>checks {r.checks.ok ? "pass" : "fail"}</span>}
								</div>
								<p className="mt-1 text-xs text-kumo-subtle">{[...(r.checks?.languages ?? [])].join(", ") || "no checks yet"}</p>
								<dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
									<div>
										<dd className="tabular text-lg text-wax">{r.landed.toLocaleString()}</dd>
										<dt className="text-xs text-kumo-subtle">landed</dt>
									</div>
									<div>
										<dd className="tabular text-lg text-wax">{r.inFlight.toLocaleString()}</dd>
										<dt className="text-xs text-kumo-subtle">in flight</dt>
									</div>
									<div>
										<dd className={`tabular text-lg ${r.needsYou ? "text-alarm" : "text-wax"}`}>{r.needsYou.toLocaleString()}</dd>
										<dt className="text-xs text-kumo-subtle">need you</dt>
									</div>
								</dl>
								<p className="mt-4 flex items-center justify-between text-xs text-kumo-subtle">
									<span>{ago(r.lastAt)}</span>
									{r.spend >= 0.01 && <span className="tabular">{usd(r.spend)} spent</span>}
								</p>
							</a>
						</li>
					))}
				</ul>
				<p className="mt-10 flex items-center gap-2 text-sm text-kumo-subtle">
					<PlusIcon size={14} /> Add one from any dashboard (<span className="text-kumo-default">Import</span>), or{" "}
					<a href="/docs/repositories" className="text-honey underline-offset-4 hover:underline">
						read how
					</a>
					.
				</p>
			</main>
		</div>
	);
}
