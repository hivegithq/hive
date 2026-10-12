import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Loader } from "@cloudflare/kumo/components/loader";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, type EvidencePlan, type EvidenceRun, type RepoSettings, type Snapshot } from "../api.ts";
import { SignInToAct, useCanWrite } from "../ui/Account.tsx";
import { EvidenceList } from "./Evidence.tsx";

// What the merge queue checks in this repository, a way to run it on trunk, and the settings
// that shape landing.
export function ChecksPanel({ repo, last, onClose }: { repo: string; last: Snapshot["trunkChecks"]; onClose: () => void }) {
	const [plan, setPlan] = useState<EvidencePlan | null>(null);
	const [settings, setSettings] = useState<RepoSettings | null>(null);
	const [result, setResult] = useState<{ commit: string; runs: EvidenceRun[]; ms: number } | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canWrite = useCanWrite();

	const load = () => {
		api.checkPlan(repo).then(setPlan, (e) => setError(e.message));
		api.settings(repo).then(setSettings, (e) => setError(e.message));
	};
	useEffect(load, [repo]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const save = async (patch: Partial<RepoSettings>) => {
		setError(null);
		try {
			setSettings(await api.setSettings(repo, patch));
			if ("security" in patch) api.checkPlan(repo).then(setPlan, () => {});
		} catch (e) {
			setError((e as Error).message);
		}
	};

	const run = async () => {
		setRunning(true);
		setError(null);
		setResult(null);
		try {
			const r = await api.runChecks(repo);
			setResult({ commit: r.commit, runs: r.runs, ms: r.ms });
			setPlan(r.plan);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(false);
		}
	};

	return (
		<motion.aside
			initial={{ x: "100%" }}
			animate={{ x: 0 }}
			exit={{ x: "100%" }}
			transition={{ type: "spring", stiffness: 380, damping: 38 }}
			className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[520px] flex-col border-l border-white/10 bg-[#111114]/95 shadow-2xl backdrop-blur-xl"
			aria-label="Checks and settings"
		>
			<header className="flex items-start gap-3 border-b border-white/5 p-5">
				<div className="min-w-0 flex-1">
					<h2 className="font-display text-xl font-semibold text-wax">Checks & settings</h2>
					<p className="mt-1 text-sm text-kumo-subtle">What has to pass before anything lands on {repo}.</p>
				</div>
				<Button variant="ghost" shape="square" icon={XIcon} onClick={onClose} aria-label="Close" />
			</header>
			<div className="flex-1 space-y-8 overflow-y-auto p-5">
				{error && <p className="text-sm text-kumo-danger">{error}</p>}

				<section>
					<h3 className="mb-3 font-display text-sm font-semibold tracking-wide text-honey">What Hive checks here</h3>
					{!plan ? (
						<Loader />
					) : plan.source === "none" ? (
						<p className="text-sm text-kumo-subtle">
							Nothing recognizable on trunk yet, so changes land on review alone. Add a <code className="font-mono text-kumo-default">hive.json</code> with the commands
							that prove this repository works.
						</p>
					) : (
						<div className="space-y-4">
							<p className="flex flex-wrap items-center gap-1.5 text-sm text-kumo-subtle">
								<Badge variant={plan.source === "hive.json" ? "orange" : "neutral"}>{plan.source === "hive.json" ? "from hive.json" : "detected"}</Badge>
								{plan.languages.map((l) => (
									<Badge key={l} variant="outline">
										{l}
									</Badge>
								))}
								{plan.security && <Badge variant="red">security scan on</Badge>}
							</p>
							{plan.setup.length > 0 && (
								<div>
									<p className="mb-1.5 text-xs text-kumo-subtle">Setup (re-runs when its files change)</p>
									<ul className="space-y-1">
										{plan.setup.map((s) => (
											<li key={s.command} className="cut-sm truncate bg-black/30 px-3 py-1.5 font-mono text-xs text-kumo-default ring-1 ring-white/5">
												{s.command}
											</li>
										))}
									</ul>
								</div>
							)}
							<div>
								<p className="mb-1.5 text-xs text-kumo-subtle">Checks, in order</p>
								<ul className="space-y-1">
									{plan.checks.map((c) => (
										<li key={c.command} className="cut-sm flex items-center gap-2 bg-black/30 px-3 py-1.5 ring-1 ring-white/5">
											<span className="w-16 shrink-0 text-xs text-honey">{c.kind}</span>
											<span className="truncate font-mono text-xs text-kumo-default">{c.command}</span>
										</li>
									))}
									{plan.security && (
										<li className="cut-sm flex items-center gap-2 bg-black/30 px-3 py-1.5 ring-1 ring-white/5">
											<span className="w-16 shrink-0 text-xs text-alarm">security</span>
											<span className="truncate text-xs text-kumo-default">gitleaks, osv-scanner, Semgrep: new findings fail</span>
										</li>
									)}
								</ul>
							</div>
							{plan.problems.map((p) => (
								<p key={p} className="text-sm text-kumo-danger">
									{p}
								</p>
							))}
						</div>
					)}
				</section>

				<section>
					<div className="mb-3 flex items-center gap-3">
						<h3 className="font-display text-sm font-semibold tracking-wide text-honey">Run on trunk</h3>
						{canWrite && (
							<Button className="ml-auto" size="sm" variant="primary" icon={PlayIcon} loading={running} onClick={run}>
								Run checks
							</Button>
						)}
					</div>
					{running ? (
						<p className="flex items-center gap-3 text-sm text-kumo-subtle">
							<Loader /> Setting up a merge box, installing dependencies and running every check. A minute or two, longer with the security scan.
						</p>
					) : result ? (
						<div className="space-y-2">
							<p className="text-sm text-kumo-subtle">
								{result.runs.every((r) => r.ok) ? "Everything passed" : `${result.runs.filter((r) => !r.ok).length} failed`} at{" "}
								<span className="font-mono text-kumo-default">{result.commit.slice(0, 8)}</span> in {Math.round(result.ms / 1000)} s.
							</p>
							<EvidenceList runs={result.runs.map((r, i) => ({ ...r, id: String(i) }))} />
						</div>
					) : last ? (
						<div className="space-y-2">
							<p className="text-sm text-kumo-subtle">
								Last run {new Date(last.at).toLocaleString()} at <span className="font-mono text-kumo-default">{last.commit.slice(0, 8)}</span>:{" "}
								<span className={last.ok ? "text-honey" : "text-alarm"}>{last.ok ? "everything passed" : "something failed"}</span>.
							</p>
							<ul className="space-y-1">
								{last.runs.map((r) => (
									<li key={r.command} className="cut-sm flex items-center gap-2 bg-black/30 px-3 py-1.5 ring-1 ring-white/5">
										<Badge variant={r.ok ? "success" : "error"} appearance="dot">
											{r.ok ? "passed" : "failed"}
										</Badge>
										<span className="w-14 shrink-0 text-xs text-honey">{r.kind}</span>
										<span className="truncate font-mono text-xs text-kumo-default">{r.command}</span>
									</li>
								))}
							</ul>
						</div>
					) : (
						<p className="text-sm text-kumo-subtle">Check that Hive can build and test trunk, for instance right after an import.</p>
					)}
				</section>

				<section className="space-y-5">
					<h3 className="font-display text-sm font-semibold tracking-wide text-honey">Settings</h3>
					{!canWrite && <SignInToAct what="run checks or change these settings" />}
					{!settings ? (
						<Loader />
					) : (
						<>
							<Switch
								label="Security scan: changes that introduce a secret, a vulnerable dependency or a risky pattern are sent back"
								checked={settings.security}
								disabled={!canWrite}
								onCheckedChange={(v) => save({ security: v })}
							/>
							<Select
								label="Who decides to land"
								value={settings.decider}
								disabled={!canWrite}
								onValueChange={(v) => v && save({ decider: v as RepoSettings["decider"] })}
								items={{ clef: "Clef, on evidence and a review", evidence: "The checks alone (no model calls)" }}
							/>
							<Input
								label="Default budget per goal, USD"
								type="number"
								min={0}
								step="0.5"
								defaultValue={settings.goalBudget ? String(settings.goalBudget) : ""}
								placeholder="No limit"
								disabled={!canWrite}
								onBlur={(e) => {
									const n = Number(e.target.value);
									const next = n > 0 ? n : null;
									if (next !== settings.goalBudget) save({ goalBudget: next });
								}}
								description="For goals without their own budget. A plan's budget covers all its sub-goals."
							/>
							<Input
								label="Changes per batch"
								type="number"
								min={1}
								max={256}
								defaultValue={String(settings.batchMax)}
								disabled={!canWrite}
								onBlur={(e) => {
									const n = Number(e.target.value);
									if (n >= 1 && n <= 256 && n !== settings.batchMax) save({ batchMax: n });
								}}
								description="Stacked and checked together. Bigger batches land more per run; a failing one is split to find the culprit."
							/>
						</>
					)}
				</section>
			</div>
		</motion.aside>
	);
}
