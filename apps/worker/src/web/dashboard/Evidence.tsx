import { Badge } from "@cloudflare/kumo/components/badge";
import { type Finding, parseSecurity } from "../../evidence/parse.ts";

interface Run {
	id: string;
	kind: string;
	command: string;
	ok: boolean;
	output: string;
}

function FindingRow({ f, tone }: { f: Finding; tone: "red" | "green" }) {
	return (
		<li className="cut-sm bg-black/30 px-3 py-2 ring-1 ring-white/5">
			<p className="flex flex-wrap items-center gap-1.5 text-xs">
				<Badge variant={tone === "red" ? "red" : "green"}>{f.tool}</Badge>
				<span className="font-mono text-kumo-default">{f.rule}</span>
				<span className="font-mono text-kumo-subtle">{f.where}</span>
			</p>
			<p className="mt-1 line-clamp-2 text-xs text-kumo-subtle">{f.message}</p>
		</li>
	);
}

function SecurityRun({ run }: { run: Run }) {
	const s = parseSecurity(run.output);
	return (
		<div className="cut-sm space-y-3 bg-black/20 p-3 ring-1 ring-white/5">
			<p className="flex flex-wrap items-center gap-2 text-sm">
				<Badge variant={run.ok ? "success" : "error"} appearance="dot">
					security
				</Badge>
				<span className={`tabular ${s.introduced.length ? "text-alarm" : "text-kumo-subtle"}`}>{s.introduced.length} introduced</span>
				<span className={`tabular ${s.resolved.length ? "text-honey" : "text-kumo-subtle"}`}>{s.resolved.length} resolved</span>
				<span className="tabular text-kumo-subtle">{s.unchanged} unchanged</span>
			</p>
			{s.introduced.length > 0 && (
				<ul className="space-y-1.5">
					{s.introduced.map((f) => (
						<FindingRow key={`${f.tool}${f.rule}${f.where}`} f={f} tone="red" />
					))}
				</ul>
			)}
			{s.resolved.length > 0 && (
				<ul className="space-y-1.5">
					{s.resolved.map((f) => (
						<FindingRow key={`${f.tool}${f.rule}${f.where}`} f={f} tone="green" />
					))}
				</ul>
			)}
			<details>
				<summary className="cursor-pointer text-xs text-kumo-subtle">Scanner output</summary>
				<pre className="mt-2 max-h-60 overflow-auto font-mono text-xs text-kumo-subtle">{run.output}</pre>
			</details>
		</div>
	);
}

export function EvidenceList({ runs }: { runs: Run[] }) {
	return (
		<ul className="space-y-1.5">
			{runs.map((e) => (
				<li key={e.id}>
					{e.kind === "security" ? (
						<SecurityRun run={e} />
					) : (
						<details className="group cut-sm bg-black/30 ring-1 ring-white/5">
							<summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
								<Badge variant={e.ok ? "success" : "error"} appearance="dot">
									{e.ok ? "passed" : "failed"}
								</Badge>
								<span className="w-14 shrink-0 text-xs text-honey">{e.kind}</span>
								<span className="truncate font-mono text-xs text-kumo-default">{e.command}</span>
							</summary>
							<pre className="max-h-72 overflow-auto border-t border-white/5 p-3 font-mono text-xs leading-relaxed text-kumo-subtle">{e.output || "(no output)"}</pre>
						</details>
					)}
				</li>
			))}
		</ul>
	);
}
