import { useEffect, useRef, useState } from "react";
import { usd } from "../../domain/pricing.ts";
import { api, type ModelStats, modelLabel } from "../api.ts";

// How each model has done on this repository, for picking models: what it landed, how often it
// was sent back or needed a person, how long it took, and what each landing cost.
export function ModelBoard({ repo, tick }: { repo: string; tick: number }) {
	const [stats, setStats] = useState<ModelStats[] | null>(null);
	const last = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is the trigger
	useEffect(() => {
		if (last.current && Date.now() - last.current < 20_000) return;
		last.current = Date.now();
		api.models(repo).then(setStats, () => {});
	}, [repo, tick]);

	if (!stats || stats.length === 0) return null;
	const best = Math.max(...stats.map((s) => s.landed), 1);
	return (
		<section className="border-t border-white/5 px-5 py-6" aria-label="Models">
			<h2 className="font-display text-lg font-semibold text-wax">Models on {repo}</h2>
			<p className="mt-1 text-sm text-kumo-subtle">What each model's changes did here. Cost covers everything spent on them, sent-back attempts included.</p>
			<div className="mt-4 overflow-x-auto">
				<table className="w-full min-w-[640px] text-sm">
					<thead className="text-left text-xs text-kumo-subtle">
						<tr>
							<th className="py-2 pr-4 font-normal">Model</th>
							<th className="py-2 pr-4 font-normal">Landed</th>
							<th className="py-2 pr-4 text-right font-normal">Landing rate</th>
							<th className="py-2 pr-4 text-right font-normal">Sent back</th>
							<th className="py-2 pr-4 text-right font-normal">Needed a person</th>
							<th className="py-2 pr-4 text-right font-normal">Median to land</th>
							<th className="py-2 text-right font-normal">Per landed change</th>
						</tr>
					</thead>
					<tbody>
						{stats.map((s) => (
							<tr key={s.model} className="border-t border-white/5">
								<td className="py-2.5 pr-4 text-wax">{s.model === "external" ? "External agents" : modelLabel(s.model)}</td>
								<td className="py-2.5 pr-4">
									<div className="flex items-center gap-2">
										<div className="h-1.5 w-24 bg-white/5">
											<div className="h-full bg-honey" style={{ width: `${(s.landed / best) * 100}%` }} />
										</div>
										<span className="tabular text-kumo-default">
											{s.landed}
											<span className="text-kumo-subtle"> of {s.started}</span>
										</span>
									</div>
								</td>
								<td className="py-2.5 pr-4 text-right tabular text-kumo-default">{Math.round(s.landingRate * 100)}%</td>
								<td className="py-2.5 pr-4 text-right tabular text-kumo-default">{s.bounces}</td>
								<td className="py-2.5 pr-4 text-right tabular text-kumo-default">{s.escalations}</td>
								<td className="py-2.5 pr-4 text-right tabular text-kumo-default">{s.medianMinutesToLand === null ? "—" : `${Math.round(s.medianMinutesToLand)} min`}</td>
								<td className="py-2.5 text-right tabular text-kumo-default">{s.costPerLanded === null ? "—" : usd(s.costPerLanded)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
