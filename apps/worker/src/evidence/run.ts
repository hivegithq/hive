import type { EvidenceRun } from "../landing/types.ts";
import { parseSetupResult, setupScript } from "./cache.ts";
import { type EvidencePlan, PROBE_FILES, planEvidence } from "./plan.ts";
import { diffFindings, type Finding, SECURITY_SCRIPT, summarize } from "./security.ts";

// Runs a repository's evidence plan in a container: the merge box (on a stack) and agents
// (run_checks, in their fork) share it, so an agent sees what the queue will see.

export interface Shell {
	exec(command: string, timeoutMs?: number): Promise<{ exitCode: number; stdout: string; stderr: string }>;
	write(path: string, content: string): Promise<void>;
}

const MINUTES = 60 * 1000;
const tail = (s: string, n = 8000) => (s.length > n ? s.slice(-n) : s);
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export async function readPlan(sh: Shell, opts: { security?: boolean } = {}): Promise<EvidencePlan> {
	// Each present probe file as \x1e<name>\n<content>, so one round trip reads them all.
	const r = await sh.exec(`for f in ${PROBE_FILES.join(" ")}; do [ -f "$f" ] && printf '\\036%s\\n' "$f" && head -c 300000 "$f"; done; true`);
	const files: Record<string, string> = {};
	for (const block of r.stdout.split("\x1e").slice(1)) {
		const nl = block.indexOf("\n");
		files[block.slice(0, nl)] = block.slice(nl + 1);
	}
	return planEvidence(files, opts);
}

// `baseRef`: the commit to compare security findings with (trunk for the merge box).
// `cachePrefix`: where this repository's dependency archives live (null: no shared cache).
export async function gatherEvidence(
	sh: Shell,
	opts: { security?: boolean; baseRef?: string; cachePrefix?: string | null } = {},
): Promise<{ plan: EvidencePlan; runs: EvidenceRun[] }> {
	const plan = await readPlan(sh, opts);
	const runs: EvidenceRun[] = plan.problems.map((p) => ({ kind: "check", command: "hive.json", ok: false, output: p }));
	runs.push(...(await runSetup(sh, plan, opts.cachePrefix ?? null)));

	for (const c of plan.checks) {
		const r = await sh.exec(`(${c.command}) 2>&1`, 15 * MINUTES);
		runs.push({ kind: c.kind, command: c.command, ok: r.exitCode === 0, output: tail(r.stdout + r.stderr) });
	}

	if (plan.security) runs.push(await securityRun(sh, opts.baseRef ?? "HEAD"));
	return { plan, runs };
}

// Install dependencies. Each setup step re-runs only when the files it depends on change (a key
// from the command, those files, the machine and the toolchain). With a cache, a box that hasn't
// run it restores what another box installed; otherwise it installs and saves for the next one.
// Returns a run per step that did something (or failed), saying which.
export async function runSetup(sh: Shell, plan: EvidencePlan, cachePrefix: string | null = null): Promise<EvidenceRun[]> {
	const runs: EvidenceRun[] = [];
	for (const s of plan.setup) {
		const keyed = await sh.exec(`(echo ${q(s.command)}; uname -m; node -v 2>/dev/null; cat ${s.keyFiles.map(q).join(" ")} 2>/dev/null) | sha1sum | cut -c1-16`);
		const key = keyed.stdout.trim() || "nokey";
		const r = await sh.exec(setupScript({ key, command: s.command, prefix: cachePrefix, spec: s.cache ?? null, pre: s.pre }), 20 * MINUTES);
		if (r.exitCode !== 0) {
			runs.push({ kind: "setup", command: s.command, ok: false, output: tail(r.stdout + r.stderr) });
			continue;
		}
		const { cache, seconds } = parseSetupResult(r.stdout);
		if (cache === "box") continue; // already set up in this box: nothing to say
		const took = seconds === null ? "" : ` in ${seconds}s`;
		const output = cache === "hit" ? `Restored from the dependency cache${took}.` : cache === "saved" ? `Installed${took}; cached for the next box.` : `Installed${took}.`;
		runs.push({ kind: "setup", command: s.command, ok: true, output });
	}
	return runs;
}

async function securityRun(sh: Shell, baseRef: string): Promise<EvidenceRun> {
	const command = "gitleaks + osv-scanner + semgrep, compared with trunk";
	await sh.write("/tmp/hive-security.mjs", SECURITY_SCRIPT);
	const scan = async (dir: string) => {
		const r = await sh.exec(`node /tmp/hive-security.mjs ${q(dir)} 2>/tmp/hive-security.err; cat /tmp/hive-security.err >&2`, 20 * MINUTES);
		return { findings: JSON.parse(r.stdout || "[]") as Finding[], notes: r.stderr.trim() };
	};
	try {
		const current = await scan(".");
		// Trunk's findings, cached per commit: every attempt in a batch compares with the same trunk.
		const base = (await sh.exec(`git rev-parse ${q(baseRef)}`)).stdout.trim();
		let baseline: Finding[];
		const cached = await sh.exec(`cat /tmp/hive-sec-${base}.json 2>/dev/null`);
		if (cached.exitCode === 0 && cached.stdout) baseline = JSON.parse(cached.stdout);
		else {
			const wt = `/tmp/hive-base-${base.slice(0, 12)}`;
			await sh.exec(`git worktree remove --force ${wt} 2>/dev/null; git worktree add --detach ${wt} ${base} >/dev/null 2>&1`);
			baseline = (await scan(wt)).findings;
			await sh.exec(`git worktree remove --force ${wt} 2>/dev/null`);
			await sh.write(`/tmp/hive-sec-${base}.json`, JSON.stringify(baseline));
		}
		const diff = diffFindings(current.findings, baseline);
		const notes = current.notes ? `\n\nScanner notes:\n${current.notes.slice(0, 1500)}` : "";
		return { kind: "security", command, ok: diff.introduced.length === 0, output: summarize(diff) + notes };
	} catch (err) {
		return { kind: "security", command, ok: false, output: `The security scan didn't complete: ${String(err).slice(0, 500)}` };
	}
}

export function describePlan(plan: EvidencePlan): string {
	if (plan.source === "none") return "No checks found: add hive.json with the commands that prove this repository works.";
	const lines = [
		`Checks (${plan.source === "hive.json" ? "from hive.json" : `detected for ${plan.languages.join(", ")}`}):`,
		...plan.checks.map((c) => `  ${c.kind}: ${c.command}`),
	];
	if (plan.security) lines.push("  security: new findings from gitleaks, osv-scanner and semgrep fail the change");
	return lines.join("\n");
}
