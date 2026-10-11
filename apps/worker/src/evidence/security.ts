// Security evidence: secrets (gitleaks), known-vulnerable dependencies (osv-scanner) and risky code
// patterns (Semgrep's default rules, baked into the image). A change fails only on findings it
// introduces, compared with trunk, so a repository that already has issues isn't blocked by them,
// and a change that fixes some reports them as resolved.

export interface Finding {
	id: string; // stable across line moves: tool, rule, location and the offending text (for a
	// dependency: the advisory and package, not the version, so an upgrade that still has it isn't "new")
	tool: "gitleaks" | "osv-scanner" | "semgrep";
	rule: string;
	path: string;
	line: number;
	severity: string;
	message: string;
}

export interface SecurityDiff {
	introduced: Finding[];
	resolved: Finding[];
	unchanged: number;
}

export function diffFindings(current: Finding[], baseline: Finding[]): SecurityDiff {
	const before = new Set(baseline.map((f) => f.id));
	const after = new Set(current.map((f) => f.id));
	return {
		introduced: dedupe(current.filter((f) => !before.has(f.id))),
		resolved: dedupe(baseline.filter((f) => !after.has(f.id))),
		unchanged: [...after].filter((id) => before.has(id)).length,
	};
}

const dedupe = (fs: Finding[]) => [...new Map(fs.map((f) => [f.id, f])).values()];

export function summarize(d: SecurityDiff): string {
	const line = (f: Finding) => `  ${f.tool} ${f.rule} at ${f.path}${f.line ? `:${f.line}` : ""}: ${f.message.slice(0, 160)}`;
	const out = [
		d.introduced.length ? `${d.introduced.length} new finding(s) this change introduces:` : "No new findings.",
		...d.introduced.slice(0, 40).map(line),
		d.resolved.length ? `${d.resolved.length} finding(s) on trunk that this change resolves:` : "",
		...d.resolved.slice(0, 40).map(line),
		`${d.unchanged} finding(s) already on trunk, unchanged.`,
	];
	return out.filter(Boolean).join("\n");
}

// node script: scan the directory given as argv[2] and print findings as JSON. Each scanner is
// optional (a missing binary or a failed run is reported on stderr and skipped).
export const SECURITY_SCRIPT = String.raw`
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] ?? ".";
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const findings = [];
const run = (cmd, args, ok = [0, 1]) => {
	try {
		return execFileSync(cmd, args, { cwd: dir, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		if (ok.includes(e.status) && e.stdout) return e.stdout;
		console.error(cmd + " failed: " + String(e.stderr || e.message).slice(0, 400));
		return null;
	}
};
const text = (path, start, end) => {
	try {
		return readFileSync(join(dir, path), "utf8").split("\n").slice(start - 1, (end || start)).join("\n").trim();
	} catch {
		return "";
	}
};

// Secrets in the working tree (not history: that's trunk's business, not this change's).
{
	// Dependencies and build output aren't the change's code (and trunk's fresh checkout has none).
	const config = "/tmp/hive-gitleaks.toml";
	writeFileSync(config, "[extend]\nuseDefault = true\n\n[[allowlists]]\npaths = [\n" + ["(^|/)node_modules/", "(^|/)target/", "(^|/)\\.git/", "(^|/)vendor/", "(^|/)dist/", "(^|/)\\.venv/", "(^|/)__pycache__/"].map((p) => "  " + JSON.stringify(p) + ",").join("\n") + "\n]\n");
	const report = "/tmp/hive-gitleaks.json";
	rmSync(report, { force: true });
	if (run("gitleaks", ["dir", ".", "--config", config, "--no-banner", "--exit-code", "0", "--report-format", "json", "--report-path", report]) !== null && existsSync(report)) {
		for (const f of JSON.parse(readFileSync(report, "utf8") || "[]")) {
			findings.push({ id: "gitleaks|" + f.RuleID + "|" + f.File + "|" + sha(f.Secret || f.Match || ""), tool: "gitleaks", rule: f.RuleID, path: f.File, line: f.StartLine, severity: "high", message: f.Description || "secret" });
		}
	}
}

// Known vulnerabilities in dependencies, from lockfiles and manifests.
{
	const out = run("osv-scanner", ["scan", "source", "-r", "--format", "json", "."], [0, 1, 128]);
	if (out) {
		const parsed = JSON.parse(out.slice(out.indexOf("{")));
		for (const r of parsed.results || []) {
			const path = relative(dir, r.source?.path || "") || r.source?.path || "";
			for (const p of r.packages || []) {
				const pkg = p.package || {};
				for (const v of p.vulnerabilities || []) {
					findings.push({ id: "osv|" + v.id + "|" + pkg.ecosystem + "/" + pkg.name, tool: "osv-scanner", rule: v.id, path, line: 0, severity: (v.database_specific && v.database_specific.severity) || "unknown", message: pkg.name + "@" + pkg.version + ": " + (v.summary || v.details || "").slice(0, 200) });
				}
			}
		}
	}
}

// Risky code patterns.
{
	const out = run("semgrep", ["scan", "--config", "/opt/hive/semgrep-default.yml", "--json", "--quiet", "--metrics=off", "--disable-version-check", "--timeout", "20", "."], [0, 1]);
	if (out) {
		for (const r of JSON.parse(out).results || []) {
			const code = text(r.path, r.start?.line, r.end?.line);
			findings.push({ id: "semgrep|" + r.check_id + "|" + r.path + "|" + sha(code), tool: "semgrep", rule: r.check_id.split(".").pop(), path: r.path, line: r.start?.line || 0, severity: (r.extra?.severity || "").toLowerCase(), message: r.extra?.message || "" });
		}
	}
}

process.stdout.write(JSON.stringify(findings));
`;
