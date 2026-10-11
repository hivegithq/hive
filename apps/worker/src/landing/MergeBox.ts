import { DurableObject } from "cloudflare:workers";
import { containerRemote, repoHost } from "../repo/index.ts";
import { Box, sh } from "../sandbox/box.ts";

const DIR = "/workspace/trunk";

export type RebaseResult =
	| { ok: true; head: string; trunk: string; diff: string; structuralDiff: string; files: string[] }
	| { ok: false; trunk: string; conflicts: { path: string; excerpt: string }[] };

export type PushResult = { ok: true; commit: string } | { ok: false; reason: string };

export interface EvidenceRun {
	kind: "test" | "typecheck" | "build";
	command: string;
	ok: boolean;
	output: string;
}

export interface SemanticIndex {
	symbols: { path: string; name: string; kind: string }[];
	refs: { from: { path: string; name: string }; to: { path: string; name: string } }[];
}

export interface ReferentialConflict {
	changed: string; // symbol this change modified
	affected: string; // symbol on trunk (changed since genesis) that references it, or vice versa
	direction: "trunk-uses-change" | "change-uses-trunk";
}

// A container with a trunk checkout. Rebases changes with mergiraf as the merge driver,
// produces evidence, and performs the (serialized) push to trunk.
export class MergeBox extends DurableObject<Env> {
	private box = new Box(this.ctx, (policy) => this.ctx.exports.Outbound({ props: policy }));

	async prepare(input: { repo: string; fork?: string; canPush: boolean; previewRepo?: string }) {
		const host = repoHost(this.env);
		const [trunk, fork] = await Promise.all([host.get(input.repo), input.fork ? host.get(input.fork) : null]);
		if (!trunk || (input.fork && !fork)) throw new Error("trunk or fork missing");
		await this.box.ensure({
			repos: [
				{ name: input.repo, scope: input.canPush ? "write" : "read" },
				...(input.fork ? [{ name: input.fork, scope: "read" as const }] : []),
				...(input.previewRepo ? [{ name: input.previewRepo, scope: "write" as const }] : []),
			],
			hosts: ["registry.npmjs.org"],
		});
		const trunkRemote = containerRemote(this.env, trunk.remote);
		const addFork = fork ? `git remote add change ${sh(containerRemote(this.env, fork.remote))} && git fetch -q change main` : "true";
		const r = await this.box.run(
			`set -e
			if [ ! -d ${DIR}/.git ]; then git clone -q ${sh(trunkRemote)} ${DIR}; fi
			cd ${DIR}
			git remote set-url origin ${sh(trunkRemote)}
			git remote remove change 2>/dev/null || true
			git rebase --abort 2>/dev/null || true
			git fetch -q origin main
			${addFork}`,
		);
		if (r.exitCode !== 0) throw new Error(`merge box setup failed: ${r.stderr || r.stdout}`);
	}

	// Replay the change's own commits onto current trunk. mergiraf resolves structural conflicts;
	// anything it can't resolve is reported with an excerpt. The base is the merge-base, not the
	// change's genesis: an agent that synced with trunk already carries trunk's newer commits.
	async rebase(): Promise<RebaseResult> {
		const trunk = (await this.box.run(`git rev-parse origin/main`, { cwd: DIR })).stdout.trim();
		const base = (await this.box.run(`git merge-base origin/main change/main`, { cwd: DIR })).stdout.trim();
		const r = await this.box.run(
			`git checkout -q -B land change/main && git rebase -q --onto origin/main ${sh(base)} land 2>&1`,
			{ cwd: DIR },
		);
		if (r.exitCode !== 0) {
			const unmerged = (await this.box.run(`git diff --name-only --diff-filter=U`, { cwd: DIR })).stdout.trim().split("\n").filter(Boolean);
			const conflicts = await Promise.all(
				unmerged.map(async (path) => ({
					path,
					excerpt: (await this.box.run(`grep -n -A8 -B2 '^<<<<<<<' ${sh(path)} | head -60`, { cwd: DIR })).stdout,
				})),
			);
			await this.box.run(`git rebase --abort`, { cwd: DIR });
			return { ok: false, trunk, conflicts };
		}
		const head = (await this.box.run(`git rev-parse HEAD`, { cwd: DIR })).stdout.trim();
		const diff = (await this.box.run(`git diff origin/main..land | head -c 60000`, { cwd: DIR })).stdout;
		const structuralDiff = (
			await this.box.run(`GIT_EXTERNAL_DIFF='difft --color never --display inline' git diff --ext-diff origin/main..land | head -c 30000`, { cwd: DIR })
		).stdout;
		const files = (await this.box.run(`git diff --name-only origin/main..land`, { cwd: DIR })).stdout.trim().split("\n").filter(Boolean);
		return { ok: true, head, trunk, diff, structuralDiff, files };
	}

	// vai's third conflict level: did trunk change code that calls what this change modified (or vice versa)?
	async referential(): Promise<ReferentialConflict[]> {
		const base = (await this.box.run(`git merge-base origin/main change/main`, { cwd: DIR })).stdout.trim();
		const r = await this.box.run(`hive-merge referential --base ${sh(base)} --trunk origin/main --change change/main --json`, { cwd: DIR });
		if (r.exitCode !== 0) return [];
		try {
			return JSON.parse(r.stdout) as ReferentialConflict[];
		} catch {
			return [];
		}
	}

	// The semantic graph of trunk at a commit, built natively by hive-merge (tree-sitter).
	async index(input: { repo: string; commit: string }): Promise<SemanticIndex> {
		await this.prepare({ repo: input.repo, canPush: false });
		const r = await this.box.run(`hive-merge index --rev ${sh(input.commit)}`, { cwd: DIR, timeoutMs: 5 * 60 * 1000 });
		if (r.exitCode !== 0) throw new Error(`hive-merge index failed: ${r.stderr}`);
		return JSON.parse(r.stdout) as SemanticIndex;
	}

	// Deterministic evidence: whatever the repo declares in package.json (test, typecheck, build).
	async evidence(): Promise<EvidenceRun[]> {
		const pkg = await this.box.run(`cat package.json 2>/dev/null`, { cwd: DIR });
		if (pkg.exitCode !== 0) return [];
		const scripts: Record<string, string> = JSON.parse(pkg.stdout).scripts ?? {};
		await this.box.run(`npm install --silent --no-audit --no-fund >/dev/null 2>&1 || true`, { cwd: DIR, timeoutMs: 10 * 60 * 1000 });
		const runs: EvidenceRun[] = [];
		for (const kind of ["typecheck", "test", "build"] as const) {
			if (!scripts[kind]) continue;
			const command = `npm run -s ${kind}`;
			const r = await this.box.run(`${command} 2>&1`, { cwd: DIR, timeoutMs: 10 * 60 * 1000 });
			runs.push({ kind, command, ok: r.exitCode === 0, output: (r.stdout + r.stderr).slice(-8000) });
		}
		return runs;
	}

	// Fast-forward trunk to the rebased change. Fails (non-fast-forward) if trunk moved underneath.
	async push(): Promise<PushResult> {
		const r = await this.box.run(`git push -q origin land:main 2>&1`, { cwd: DIR });
		if (r.exitCode !== 0) return { ok: false, reason: r.stdout + r.stderr };
		const commit = (await this.box.run(`git rev-parse land`, { cwd: DIR })).stdout.trim();
		await this.box.run(`git fetch -q origin main`, { cwd: DIR });
		return { ok: true, commit };
	}

	// Race candidates are pushed as branches to a preview repo so Workers Builds can deploy them.
	async pushPreview(input: { previewRepo: string; branch: string }): Promise<{ ok: boolean; reason: string | null }> {
		const host = repoHost(this.env);
		const preview = await host.get(input.previewRepo);
		if (!preview) return { ok: false, reason: "no preview repo" };
		const r = await this.box.run(`git push -q --force ${sh(containerRemote(this.env, preview.remote))} land:refs/heads/${input.branch} 2>&1`, { cwd: DIR });
		return { ok: r.exitCode === 0, reason: r.exitCode === 0 ? null : r.stdout };
	}
}
