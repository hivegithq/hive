import type { CacheSpec } from "./cache.ts";
// What counts as evidence for a repository: the setup to run first and the checks whose exit
// codes decide. A repo can say exactly, in hive.json at its root; otherwise Hive detects the usual
// commands for Node, Rust, Python and Go from the manifests it finds. The same plan runs in an
// agent's container (run_checks) and in the merge box, so agents test the way the queue does.
//
// hive.json:
//   {
//     "setup": ["make deps"],                         // replaces detected setup
//     "checks": { "test": "make test", "lint": "make lint" },  // replaces detected checks
//     "security": true                               // also run the security scan (new findings fail)
//   }

export type CheckKind = "setup" | "typecheck" | "lint" | "build" | "test" | "check" | "security";

export interface Check {
	kind: CheckKind;
	name: string;
	command: string;
}

export interface Setup {
	command: string;
	keyFiles: string[]; // setup reruns only when these change
	cache?: CacheSpec; // what it installs, so another box can restore it instead of installing
}

export interface EvidencePlan {
	source: "hive.json" | "detected" | "none";
	languages: string[];
	setup: Setup[];
	checks: Check[];
	security: boolean;
	problems: string[]; // e.g. an unreadable hive.json, surfaced as a failing check
}

export interface HiveConfig {
	setup?: string[];
	checks?: Record<string, string>;
	security?: boolean;
	cache?: string[]; // paths the setup fills, kept between boxes (relative to the repo, or absolute)
}

// Files Hive looks at (repository root only; monorepos say what they want in hive.json).
export const PROBE_FILES = [
	"hive.json",
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"Cargo.toml",
	"Cargo.lock",
	"pyproject.toml",
	"requirements.txt",
	"requirements-dev.txt",
	"setup.py",
	"go.mod",
	"go.sum",
];

// Python goes in a virtualenv outside the repository, so it never ends up in a commit.
export const PY_VENV = "/tmp/hive-venv";
const py = (cmd: string) => `. ${PY_VENV}/bin/activate && ${cmd}`;

const ORDER: CheckKind[] = ["typecheck", "lint", "build", "test", "check"];
const KNOWN = new Set<string>(ORDER);

export function planEvidence(files: Record<string, string>, opts: { security?: boolean } = {}): EvidencePlan {
	const problems: string[] = [];
	let config: HiveConfig | null = null;
	if (files["hive.json"] !== undefined) {
		try {
			config = parseConfig(JSON.parse(files["hive.json"]));
		} catch (err) {
			problems.push(`hive.json: ${(err as Error).message}`);
		}
	}

	const detected = detect(files);
	const custom = config?.cache?.length ? cacheSpec(config.cache) : undefined;
	const setup = config?.setup ? config.setup.map((command) => ({ command, keyFiles: ["hive.json", ...LOCKFILES], cache: custom })) : detected.setup;
	const checks = config?.checks
		? Object.entries(config.checks).map(([name, command]) => ({ kind: (KNOWN.has(name) ? name : "check") as CheckKind, name, command }))
		: detected.checks;
	checks.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

	return {
		source: config ? "hive.json" : detected.languages.length ? "detected" : "none",
		languages: detected.languages,
		setup,
		checks,
		security: config?.security ?? opts.security ?? false,
		problems,
	};
}

const LOCKFILES = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "go.sum", "requirements.txt", "poetry.lock", "uv.lock", "Gemfile.lock"];

// hive.json's cache paths: relative ones live in the checkout; absolute ones ($HOME/…, ~/…, /…) don't.
function cacheSpec(paths: string[]): CacheSpec {
	const absolute = paths.filter((p) => /^(\/|~|\$)/.test(p)).map((p) => p.replace(/^~/, "$HOME"));
	return { local: paths.filter((p) => !absolute.includes(p) && !/^(\/|~|\$)/.test(p)), absolute };
}

function parseConfig(raw: unknown): HiveConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("expected an object");
	const c = raw as Record<string, unknown>;
	const out: HiveConfig = {};
	if (c.setup !== undefined) {
		if (!Array.isArray(c.setup) || !c.setup.every((s) => typeof s === "string")) throw new Error('"setup" must be a list of commands');
		out.setup = c.setup as string[];
	}
	if (c.cache !== undefined) {
		if (!Array.isArray(c.cache) || !c.cache.every((p) => typeof p === "string" && !p.includes("..") && !/[;&|`<>]/.test(p))) throw new Error('"cache" must be a list of paths');
		out.cache = c.cache as string[];
	}
	if (c.checks !== undefined) {
		if (!c.checks || typeof c.checks !== "object" || Array.isArray(c.checks) || !Object.values(c.checks).every((v) => typeof v === "string")) {
			throw new Error('"checks" must map a name to a command');
		}
		out.checks = c.checks as Record<string, string>;
	}
	if (c.security !== undefined) {
		if (typeof c.security !== "boolean") throw new Error('"security" must be true or false');
		out.security = c.security;
	}
	return out;
}

function detect(files: Record<string, string>): { languages: string[]; setup: Setup[]; checks: Check[] } {
	const languages: string[] = [];
	const setup: Setup[] = [];
	const checks: Check[] = [];
	const has = (f: string) => files[f] !== undefined;

	if (has("package.json")) {
		languages.push("node");
		let scripts: Record<string, string> = {};
		try {
			scripts = JSON.parse(files["package.json"]).scripts ?? {};
		} catch {
			// a broken package.json fails its own install
		}
		const install = has("pnpm-lock.yaml")
			? "corepack pnpm install --frozen-lockfile"
			: has("yarn.lock")
				? "corepack yarn install --immutable"
				: has("package-lock.json")
					? "npm ci --no-audit --no-fund"
					: "npm install --no-audit --no-fund";
		setup.push({
			command: install,
			keyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
			cache: { local: ["node_modules"], absolute: has("pnpm-lock.yaml") ? ["$(corepack pnpm store path 2>/dev/null || echo /nonexistent)"] : [] },
		});
		const runner = has("pnpm-lock.yaml") ? "corepack pnpm run -s" : has("yarn.lock") ? "corepack yarn run -s" : "npm run -s";
		for (const kind of ["typecheck", "build", "test"] as const) {
			if (scripts[kind]) checks.push({ kind, name: kind, command: `${runner} ${kind}` });
		}
	}

	if (has("Cargo.toml")) {
		languages.push("rust");
		setup.push({ command: "cargo fetch --quiet", keyFiles: ["Cargo.toml", "Cargo.lock"], cache: { local: [], absolute: ["${CARGO_HOME:-$HOME/.cargo}/registry", "${CARGO_HOME:-$HOME/.cargo}/git"] } });
		checks.push({ kind: "build", name: "cargo build", command: "cargo build --all-targets --quiet" });
		checks.push({ kind: "test", name: "cargo test", command: "cargo test --quiet" });
	}

	if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
		languages.push("python");
		const deps = [
			has("requirements.txt") ? "pip install -q -r requirements.txt" : null,
			has("requirements-dev.txt") ? "pip install -q -r requirements-dev.txt" : null,
			has("pyproject.toml") || has("setup.py") ? `(pip install -q -e ".[test]" 2>/dev/null || pip install -q -e .)` : null,
			"pip install -q pytest",
		].filter(Boolean);
		setup.push({
			command: `python3 -m venv ${PY_VENV} && ${py(deps.join(" && "))}`,
			keyFiles: ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py"],
			cache: { local: [], absolute: [PY_VENV] },
		});
		// pytest exits 5 when it collects no tests: that's not a failure of the change.
		checks.push({ kind: "test", name: "pytest", command: py("python -m pytest -q; c=$?; [ $c -eq 5 ] && exit 0; exit $c") });
	}

	if (has("go.mod")) {
		languages.push("go");
		setup.push({ command: "go mod download", keyFiles: ["go.mod", "go.sum"], cache: { local: [], absolute: ["$(go env GOMODCACHE)"] } });
		checks.push({ kind: "build", name: "go build", command: "go build ./..." });
		checks.push({ kind: "lint", name: "go vet", command: "go vet ./..." });
		checks.push({ kind: "test", name: "go test", command: "go test ./..." });
	}

	return { languages, setup, checks };
}
