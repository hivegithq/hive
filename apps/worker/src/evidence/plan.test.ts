import { describe, expect, it } from "vitest";
import { planEvidence } from "./plan.ts";
import { parseSecurity } from "./parse.ts";
import { diffFindings, type Finding, summarize } from "./security.ts";

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "x", scripts });

describe("planEvidence", () => {
	it("detects Node scripts and the package manager from the lockfile", () => {
		const p = planEvidence({ "package.json": pkg({ test: "vitest", typecheck: "tsc", lint: "eslint ." }), "pnpm-lock.yaml": "" });
		expect(p.source).toBe("detected");
		expect(p.setup[0].command).toBe("corepack enable && pnpm install --frozen-lockfile");
		// typecheck before test; lint isn't run unless hive.json asks for it
		expect(p.checks.map((c) => c.command)).toEqual(["pnpm run -s typecheck", "pnpm run -s test"]);
	});

	it("detects Rust, Python and Go, together in one repository", () => {
		const p = planEvidence({ "Cargo.toml": "", "requirements.txt": "", "go.mod": "" });
		expect(p.languages).toEqual(["rust", "python", "go"]);
		expect(p.checks.map((c) => c.name)).toEqual(["go vet", "cargo build", "go build", "cargo test", "pytest", "go test"]);
	});

	it("lets hive.json replace the checks and setup, and turn on security", () => {
		const p = planEvidence({
			"hive.json": JSON.stringify({ setup: ["make deps"], checks: { test: "make test", format: "make fmt-check" }, security: true }),
			"Cargo.toml": "",
		});
		expect(p.source).toBe("hive.json");
		expect(p.setup.map((s) => s.command)).toEqual(["make deps"]);
		expect(p.checks).toEqual([
			{ kind: "test", name: "test", command: "make test" },
			{ kind: "check", name: "format", command: "make fmt-check" },
		]);
		expect(p.security).toBe(true);
	});

	it("keeps detected setup when hive.json only sets checks", () => {
		const p = planEvidence({ "hive.json": JSON.stringify({ checks: { test: "cargo nextest run" } }), "Cargo.toml": "" });
		expect(p.setup.map((s) => s.command)).toEqual(["cargo fetch --quiet"]);
		expect(p.checks.map((c) => c.command)).toEqual(["cargo nextest run"]);
	});

	it("reports a broken hive.json instead of silently ignoring it", () => {
		const p = planEvidence({ "hive.json": "{ nope", "go.mod": "" });
		expect(p.problems[0]).toMatch(/^hive.json:/);
		expect(p.checks.length).toBe(3); // falls back to detection
		expect(planEvidence({ "hive.json": JSON.stringify({ checks: ["make test"] }) }).problems[0]).toMatch(/"checks" must map/);
	});

	it("has nothing to run when there's nothing it recognizes", () => {
		const p = planEvidence({});
		expect(p.source).toBe("none");
		expect(p.checks).toEqual([]);
	});
});

const f = (id: string): Finding => ({ id, tool: "semgrep", rule: id, path: "a.ts", line: 1, severity: "high", message: id });

describe("diffFindings", () => {
	it("separates what a change introduces from what it resolves and what was already there", () => {
		const d = diffFindings([f("a"), f("b"), f("new")], [f("a"), f("b"), f("gone")]);
		expect(d.introduced.map((x) => x.id)).toEqual(["new"]);
		expect(d.resolved.map((x) => x.id)).toEqual(["gone"]);
		expect(d.unchanged).toBe(2);
	});

	it("counts a finding once however many times a scanner reports it", () => {
		expect(diffFindings([f("x"), f("x")], []).introduced).toHaveLength(1);
	});
});

describe("parseSecurity", () => {
	it("reads back exactly what summarize writes", () => {
		const finding = (id: string, tool: Finding["tool"]): Finding => ({ id, tool, rule: `rule-${id}`, path: `src/${id}.ts`, line: 3, severity: "high", message: `bad ${id}` });
		const text = summarize(diffFindings([finding("new", "gitleaks"), finding("kept", "semgrep")], [finding("kept", "semgrep"), finding("gone", "osv-scanner")]));
		const s = parseSecurity(text);
		expect(s.introduced).toEqual([{ tool: "gitleaks", rule: "rule-new", where: "src/new.ts:3", message: "bad new" }]);
		expect(s.resolved.map((f) => f.rule)).toEqual(["rule-gone"]);
		expect(s.unchanged).toBe(1);
	});
});
