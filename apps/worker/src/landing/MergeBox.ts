import { DurableObject } from "cloudflare:workers";
import { containerRemote, repoHost } from "../repo/index.ts";
import { Box, sh } from "../sandbox/box.ts";

const DIR = "/workspace/trunk";
// Fork fetches are mostly round trips, not bandwidth, so they parallelize well.
const FETCH_PARALLELISM = 32;

// Fetch one fork's main into refs/remotes/<fork>/main (two tries); prints FAIL<tab>fork<tab>base64(err).
const FETCH_ONE = `cd ${"$"}{DIR:-/workspace/trunk}
name="$1"; url="$2"
for try in 1 2; do
  if err=$(git fetch -q "$url" "+refs/heads/main:refs/remotes/$name/main" 2>&1); then exit 0; fi
  sleep 1
done
printf 'FAIL\\t%s\\t%s\\n' "$name" "$(printf '%s' "$err" | base64 -w0)"
`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Reads "<changeId> <fork>" lines; prints TRUNK, then OK / EMPTY / CONFLICT per change (tab-separated,
// file lists and conflict excerpts base64-encoded).
const STACK_SCRIPT = `set -u
cd ${"$"}{DIR:-/workspace/trunk}
git cherry-pick --abort >/dev/null 2>&1
git fetch -q origin main
git checkout -q -f -B land origin/main && git clean -qfd
tip=$(git rev-parse HEAD)
printf 'TRUNK\\t%s\\n' "$tip"
while read -r id fork; do
  [ -z "$id" ] && continue
  ref="$fork/main"
  base=$(git merge-base origin/main "$ref" 2>/dev/null)
  if [ -z "$base" ] || [ "$(git rev-list --count "$base..$ref" 2>/dev/null || echo 0)" = "0" ]; then
    printf 'EMPTY\\t%s\\n' "$id"; continue
  fi
  if git cherry-pick --allow-empty --keep-redundant-commits "$base..$ref" >/tmp/hive-pick.log 2>&1; then
    next=$(git rev-parse HEAD)
    files=$(git diff --name-only "$tip" "$next" | base64 -w0)
    printf 'OK\\t%s\\t%s\\t%s\\t%s\\n' "$id" "$tip" "$next" "$files"
    tip=$next
  else
    excerpt=$(for f in $(git diff --name-only --diff-filter=U); do printf '%s\\n' "$f"; grep -n -A8 -B2 '^<<<<<<<' "$f" | head -60; printf '\\036'; done | base64 -w0)
    git cherry-pick --abort >/dev/null 2>&1; git reset -q --hard "$tip"
    printf 'CONFLICT\\t%s\\t%s\\n' "$id" "$excerpt"
  fi
done
`;

export interface StackEntry {
	changeId: string;
	fork: string; // Artifacts repo name, also used as the git remote name
}

export type Stacked =
	| { changeId: string; ok: true; prev: string; tip: string; files: string[] }
	| { changeId: string; ok: false; conflicts: { path: string; excerpt: string }[] }
	| { changeId: string; ok: false; empty: true };

export interface StackResult {
	trunk: string;
	tip: string; // tip of the stack after every change that applied
	entries: Stacked[];
}

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
	affected: string; // symbol on trunk (changed since the change's base) that references it, or vice versa
	direction: "trunk-uses-change" | "change-uses-trunk";
}

// A container with a trunk checkout. Builds a stack of changes on top of trunk (mergiraf as the merge
// driver), produces evidence for the whole stack at once, and performs the single push to trunk.
export class MergeBox extends DurableObject<Env> {
	private box = new Box(this.ctx, (policy) => this.ctx.exports.Outbound({ props: policy }));

	private run(command: string, timeoutMs?: number) {
		return this.box.run(command, { cwd: DIR, timeoutMs });
	}

	// Check out trunk and fetch every fork in the batch as its own remote.
	// Returns the forks that couldn't be fetched; their changes are bounced rather than failing the batch.
	async prepare(input: { repo: string; forks: string[]; canPush: boolean; previewRepo?: string; mirrors?: string[] }): Promise<{ unavailable: { fork: string; error: string }[] }> {
		const trunk = await repoHost(this.env).get(input.repo);
		if (!trunk) throw new Error(`trunk ${input.repo} missing`);
		// Sibling repos share trunk's remote layout, so their URLs need no lookups (one per fork
		// would spend the namespace's control-plane budget on every batch).
		const trunkRemote = containerRemote(this.env, trunk.remote);
		const sibling = (name: string) => trunkRemote.replace(new RegExp(`/${escapeRe(input.repo)}\\.git$`), `/${name}.git`);

		// A static, pattern-based policy: the same for every batch this box ever runs.
		const write = input.canPush ? ("write" as const) : ("read" as const);
		await this.box.ensure({
			repos: [
				{ name: input.repo, scope: write },
				{ name: `${input.repo}.m-*`, scope: write },
				{ name: `${input.repo}.preview`, scope: "write" },
				{ name: `${input.repo}.*`, scope: "read" },
			],
			hosts: ["registry.npmjs.org"],
		});
		this.mirrorRemotes = Object.fromEntries((input.mirrors ?? []).map((name) => [name, sibling(name)]));
		const r = await this.box.run(
			`set -e
			if [ ! -d ${DIR}/.git ]; then git clone -q ${sh(trunkRemote)} ${DIR}; fi
			cd ${DIR}
			git cherry-pick --abort 2>/dev/null || true
			git rebase --abort 2>/dev/null || true
			git remote set-url origin ${sh(trunkRemote)}
			git fetch -q origin main`,
			{ timeoutMs: 10 * 60 * 1000 },
		);
		if (r.exitCode !== 0) throw new Error(`merge box setup failed: ${r.stderr || r.stdout}`);
		if (input.forks.length === 0) return { unavailable: [] };

		// Each fork is fetched on its own (32 at a time, two tries), straight into refs/remotes/<fork>/main,
		// so one bad fork can't sink the batch. Failures come back with git's error for the bounce reason.
		await this.box.files().writeFile("/tmp/hive-forks", input.forks.map((name) => `${name} ${sibling(name)}`).join("\n") + "\n");
		await this.box.files().writeFile("/tmp/hive-fetch-one.sh", FETCH_ONE);
		const f = await this.run(`xargs -P ${FETCH_PARALLELISM} -L 1 bash /tmp/hive-fetch-one.sh < /tmp/hive-forks`, 10 * 60 * 1000);
		const unavailable = f.stdout
			.split("\n")
			.filter((l) => l.startsWith("FAIL\t"))
			.map((l) => {
				const [, fork, err] = l.split("\t");
				return { fork, error: err ? new TextDecoder().decode(Uint8Array.from(atob(err), (c) => c.charCodeAt(0))).trim().slice(-500) : "unknown" };
			});
		if (unavailable.length) console.warn(`merge box: ${unavailable.length}/${input.forks.length} forks unavailable`, unavailable.slice(0, 3));
		return { unavailable };
	}

	// Stack each change's own commits (merge-base..fork) onto trunk, in order. Changes that don't
	// apply are skipped and reported with conflict excerpts; the rest carry on. The whole loop runs
	// as one script in the container: one round trip per batch instead of several per change.
	async stack(entries: StackEntry[]): Promise<StackResult> {
		await this.box.files().writeFile("/tmp/hive-stack.sh", STACK_SCRIPT);
		await this.box.files().writeFile("/tmp/hive-stack.in", entries.map((e) => `${e.changeId} ${e.fork}`).join("\n") + "\n");
		const r = await this.run("bash /tmp/hive-stack.sh < /tmp/hive-stack.in", 10 * 60 * 1000);
		if (r.exitCode !== 0) throw new Error(`stacking failed: ${r.stderr || r.stdout}`);
		const b64 = (x: string) => (x ? new TextDecoder().decode(Uint8Array.from(atob(x), (c) => c.charCodeAt(0))) : "");
		let trunk = "";
		let tip = "";
		const out: Stacked[] = [];
		for (const line of r.stdout.split("\n")) {
			const [tag, ...f] = line.split("\t");
			if (tag === "TRUNK") trunk = tip = f[0];
			else if (tag === "OK") {
				out.push({ changeId: f[0], ok: true, prev: f[1], tip: f[2], files: b64(f[3]).split("\n").filter(Boolean) });
				tip = f[2];
			} else if (tag === "EMPTY") out.push({ changeId: f[0], ok: false, empty: true });
			else if (tag === "CONFLICT") {
				const conflicts = b64(f[1])
					.split("\x1e")
					.filter(Boolean)
					.map((block) => {
						const [path, ...rest] = block.split("\n");
						return { path, excerpt: rest.join("\n") };
					});
				out.push({ changeId: f[0], ok: false, conflicts: conflicts.length ? conflicts : [{ path: "(unknown)", excerpt: "cherry-pick failed" }] });
			}
		}
		return { trunk, tip, entries: out };
	}

	// One change's slice of the stack, for review.
	async diff(prev: string, tip: string): Promise<{ diff: string; structuralDiff: string }> {
		const range = sh(`${prev}..${tip}`);
		const diff = (await this.run(`git diff ${range} | head -c 60000`)).stdout;
		const structuralDiff = (await this.run(`GIT_EXTERNAL_DIFF='difft --color never --display inline' git diff --ext-diff ${range} | head -c 30000`)).stdout;
		return { diff, structuralDiff };
	}

	// vai's third conflict level, per change: did trunk change code that calls what this change
	// modified (or vice versa) since the change's base?
	async referential(fork: string): Promise<ReferentialConflict[]> {
		const ref = sh(`${fork}/main`);
		const base = (await this.run(`git merge-base origin/main ${ref}`)).stdout.trim();
		const r = await this.run(`hive-merge referential --base ${sh(base)} --trunk origin/main --change ${ref} --json`);
		if (r.exitCode !== 0) return [];
		try {
			return JSON.parse(r.stdout) as ReferentialConflict[];
		} catch {
			return [];
		}
	}

	// The semantic graph of trunk at a commit, built natively by hive-merge (tree-sitter).
	async index(input: { repo: string; commit: string }): Promise<SemanticIndex> {
		await this.prepare({ repo: input.repo, forks: [], canPush: false });
		const r = await this.run(`hive-merge index --rev ${sh(input.commit)}`, 5 * 60 * 1000);
		if (r.exitCode !== 0) throw new Error(`hive-merge index failed: ${r.stderr}`);
		return JSON.parse(r.stdout) as SemanticIndex;
	}

	// Deterministic evidence for the current checkout: whatever package.json declares.
	// Dependencies are reinstalled only when the lockfile or manifest changed.
	async evidence(): Promise<EvidenceRun[]> {
		const pkg = await this.run("cat package.json 2>/dev/null");
		if (pkg.exitCode !== 0) return [];
		const scripts: Record<string, string> = JSON.parse(pkg.stdout).scripts ?? {};
		await this.run(
			`h=$(cat package.json package-lock.json 2>/dev/null | sha1sum | cut -c1-40)
			if [ "$(cat node_modules/.hive-hash 2>/dev/null)" != "$h" ]; then
				npm install --silent --no-audit --no-fund >/dev/null 2>&1 && echo "$h" > node_modules/.hive-hash || true
			fi`,
			10 * 60 * 1000,
		);
		const runs: EvidenceRun[] = [];
		for (const kind of ["typecheck", "test", "build"] as const) {
			if (!scripts[kind]) continue;
			const command = `npm run -s ${kind}`;
			const r = await this.run(`${command} 2>&1`, 10 * 60 * 1000);
			runs.push({ kind, command, ok: r.exitCode === 0, output: (r.stdout + r.stderr).slice(-8000) });
		}
		return runs;
	}

	// Fast-forward trunk to exactly `commit`: the tip of the stack whose evidence passed (not whatever
	// was stacked last; a culprit search leaves failing stacks checked out). Fails if trunk moved
	// underneath, or if this container no longer has the commit (it restarted).
	async push(commit: string): Promise<PushResult> {
		if ((await this.run(`git cat-file -e ${sh(`${commit}^{commit}`)}`)).exitCode !== 0) return { ok: false, reason: "verified commit not in this container" };
		const r = await this.run(`git push -q origin ${sh(`${commit}:refs/heads/main`)} 2>&1`);
		if (r.exitCode !== 0) return { ok: false, reason: r.stdout + r.stderr };
		await this.run("git fetch -q origin main");
		return { ok: true, commit };
	}

	private mirrorRemotes: Record<string, string> = {};

	// Bring every fork mirror up to trunk, so new changes fork from current code.
	async refreshMirrors(): Promise<{ refreshed: number; failed: string[] }> {
		const failed: string[] = [];
		const entries = Object.entries(this.mirrorRemotes).filter(([, remote]) => remote);
		await Promise.all(
			entries.map(async ([name, remote]) => {
				const r = await this.run(`git push -q --force ${sh(remote)} origin/main:refs/heads/main 2>&1`);
				if (r.exitCode !== 0) failed.push(name);
			}),
		);
		return { refreshed: entries.length - failed.length, failed };
	}

	// Race candidates are pushed as branches to a preview repo so Workers Builds can deploy them.
	async pushPreview(input: { previewRepo: string; branch: string }): Promise<{ ok: boolean; reason: string | null }> {
		const preview = await repoHost(this.env).get(input.previewRepo);
		if (!preview) return { ok: false, reason: "no preview repo" };
		const r = await this.run(`git push -q --force ${sh(containerRemote(this.env, preview.remote))} land:refs/heads/${input.branch} 2>&1`);
		return { ok: r.exitCode === 0, reason: r.exitCode === 0 ? null : r.stdout };
	}
}
