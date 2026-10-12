import { DurableObject } from "cloudflare:workers";
import { containerRemote, repoHost } from "../repo/index.ts";
import { Box, sh } from "../sandbox/box.ts";
import { gatherEvidence } from "../evidence/run.ts";
import { REGISTRY_HOSTS } from "../sandbox/registries.ts";
import { UNION_SCRIPT } from "./union.ts";

const DIR = "/workspace/trunk";
// Fork fetches cost about a second of CPU each (TLS through the egress gateway, then git). Measured
// in a merge box, 13 forks: 13.4 s on standard-1 at any parallelism, 4.9 s on standard-4.
const FETCH_PARALLELISM = 16;

// Fetch one fork's main into refs/remotes/<fork>/main (two tries, each time-boxed so one stuck
// connection can't hold the whole batch); prints MS<tab>fork<tab>millis, or FAIL<tab>fork<tab>base64(err).
const FETCH_ONE = `cd ${"$"}{DIR:-/workspace/trunk}
name="$1"; url="$2"; t0=$(date +%s%3N)
for try in 1 2; do
  if err=$(timeout 120 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 -c gc.auto=0 -c maintenance.auto=false -c fetch.writeCommitGraph=false fetch -q --no-tags --no-auto-gc --no-write-fetch-head "$url" "+refs/heads/main:refs/remotes/$name/main" 2>&1); then
    printf 'MS\\t%s\\t%s\\n' "$name" "$(( $(date +%s%3N) - t0 ))"; exit 0
  fi
  [ -z "$err" ] && err="timed out after 120s"
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
printf 'TRUNK\\t%s\\n' "$(git rev-parse HEAD)"
# ONTO: continue from an already-verified stack (a commit made earlier in this container).
if [ -n "${"$"}{ONTO:-}" ]; then
  git checkout -q -f -B land "$ONTO" 2>/dev/null || { printf 'NOBASE\\n'; exit 0; }
fi
tip=$(git rev-parse HEAD)
# Cherry-pick a range; when it stops on conflicts that are purely additive, keep both sides and go on.
pick() {
  git cherry-pick --allow-empty --keep-redundant-commits "$1" >/tmp/hive-pick.log 2>&1 && return 0
  while :; do
    u=$(git diff --name-only --diff-filter=U)
    [ -z "$u" ] && return 1
    node /tmp/hive-union.cjs $u || return 1
    git add -- $u
    unioned="$unioned$u
"
    GIT_EDITOR=true git cherry-pick --continue >/tmp/hive-pick.log 2>&1 && return 0
  done
}
while read -r id fork; do
  [ -z "$id" ] && continue
  ref="$fork/main"
  base=$(git merge-base origin/main "$ref" 2>/dev/null)
  if [ -z "$base" ] || [ "$(git rev-list --count "$base..$ref" 2>/dev/null || echo 0)" = "0" ]; then
    printf 'EMPTY\\t%s\\n' "$id"; continue
  fi
  unioned=""
  if pick "$base..$ref"; then
    next=$(git rev-parse HEAD)
    files=$(git diff --name-only "$tip" "$next" | base64 -w0)
    printf 'OK\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$id" "$tip" "$next" "$files" "$(printf '%s' "$unioned" | base64 -w0)"
    tip=$next
  else
    excerpt=$(for f in $(git diff --name-only --diff-filter=U); do printf '%s\\n' "$f"; grep -n -A8 -B2 '^<<<<<<<' "$f" | head -60; printf '\\036'; done | base64 -w0)
    # Not a content conflict: say what git said instead.
    [ -z "$excerpt" ] && excerpt=$( { printf '(git)\\n'; tail -c 1500 /tmp/hive-pick.log; printf '\\036'; } | base64 -w0)
    git cherry-pick --abort >/dev/null 2>&1; git reset -q --hard "$tip"
    printf 'CONFLICT\\t%s\\t%s\\n' "$id" "$excerpt"
  fi
done
`;

interface BoxConfig {
	repo: string;
	trunkRemote: string; // as the container addresses it
	canPush: boolean;
	mirrors: string[];
}

export type { EvidenceRun, PushResult, StackEntry, Stacked, StackResult } from "./types.ts";
import type { EvidenceRun, PushResult, StackEntry, Stacked, StackResult } from "./types.ts";

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
	// Four vCPUs: fetching forks is CPU-bound (TLS and git per fork), and a repo has only a couple of
	// merge boxes, so they're where landing throughput is decided.
	private box = new Box(this.ctx, (policy) => this.ctx.exports.Outbound({ props: policy }), "standard-4");

	private run(command: string, timeoutMs?: number) {
		return this.box.run(command, { cwd: DIR, timeoutMs });
	}

	// What this box serves, kept in storage so a restarted object or container can set itself up again.
	private config: BoxConfig | null = null;

	private async cfg(): Promise<BoxConfig> {
		this.config ??= (await this.ctx.storage.get<BoxConfig>("config")) ?? null;
		if (!this.config) throw new Error("merge box was never prepared");
		return this.config;
	}

	// Sibling repos share trunk's remote layout, so their URLs need no lookups (one per fork
	// would spend the namespace's control-plane budget on every batch).
	private sibling(c: BoxConfig, name: string) {
		return c.trunkRemote.replace(new RegExp(`/${escapeRe(c.repo)}\\.git$`), `/${name}.git`);
	}

	// The container running, under its policy, with trunk checked out. Cheap when it already is.
	// Many calls arrive at once (per-change checks run in parallel); they share one setup, and the
	// setup runs only after the container (re)starts, since it writes .git/config.
	private readying: Promise<BoxConfig> | null = null;
	private setUp = false;

	private ready(): Promise<BoxConfig> {
		this.readying ??= this.doReady().finally(() => {
			this.readying = null;
		});
		return this.readying;
	}

	private async doReady(): Promise<BoxConfig> {
		const c = await this.cfg();
		// A static, pattern-based policy: the same for every batch this box ever runs.
		const started = await this.box.ensure({
			repos: [
				{ name: c.repo, scope: c.canPush ? "write" : "read" },
				{ name: `${c.repo}.m-*`, scope: c.canPush ? "write" : "read" },
				{ name: `${c.repo}.preview`, scope: "write" },
				{ name: `${c.repo}.*`, scope: "read" },
			],
			hosts: REGISTRY_HOSTS,
		});
		if (started) this.setUp = false;
		if (this.setUp) return c;
		const r = await this.box.run(
			`set -e
			rm -f ${DIR}/.git/config.lock
			if [ ! -d ${DIR}/.git ]; then git clone -q ${sh(c.trunkRemote)} ${DIR}; fi
			cd ${DIR}
			git config gc.auto 0; git config maintenance.auto false
			git remote set-url origin ${sh(c.trunkRemote)}`,
			{ timeoutMs: 10 * 60 * 1000 },
		);
		if (r.exitCode !== 0) throw new Error(`merge box setup failed: ${r.stderr || r.stdout}`);
		this.setUp = true;
		return c;
	}

	// Check out current trunk and forget forks from earlier batches. Forks are fetched separately
	// (fetchForks), a few at a time, so no single call runs long enough to be cut off.
	async prepare(input: { repo: string; canPush: boolean; mirrors?: string[] }): Promise<void> {
		const trunk = await repoHost(this.env).get(input.repo);
		if (!trunk) throw new Error(`trunk ${input.repo} missing`);
		const c: BoxConfig = { repo: input.repo, trunkRemote: containerRemote(this.env, trunk.remote), canPush: input.canPush, mirrors: input.mirrors ?? [] };
		this.config = c;
		await this.ctx.storage.put("config", c);
		const prepStart = Date.now();
		await this.ready();
		console.log(`merge box: ready in ${Date.now() - prepStart}ms (${(await this.run("nproc")).stdout.trim()} vCPU)`);
		const r = await this.run(
			`git cherry-pick --abort 2>/dev/null; git rebase --abort 2>/dev/null
			# Thousands of stale fork refs slow every fetch.
			git for-each-ref --format='delete %(refname)' refs/remotes | { grep -v ' refs/remotes/origin/' || true; } | git update-ref --stdin
			git fetch -q origin main`,
			10 * 60 * 1000,
		);
		if (r.exitCode !== 0) throw new Error(`merge box setup failed: ${r.stderr || r.stdout}`);
	}

	// Fetch forks into refs/remotes/<fork>/main. Returns the ones that couldn't be fetched, with git's error.
	async fetchForks(forks: string[]): Promise<{ unavailable: { fork: string; error: string }[] }> {
		const c = await this.ready();
		if (forks.length === 0) return { unavailable: [] };
		// Calls can overlap (per-change checks run in parallel), so each gets its own files.
		const tag = crypto.randomUUID().slice(0, 8);
		await this.box.files().writeFile(`/tmp/hive-forks-${tag}`, forks.map((name) => `${name} ${this.sibling(c, name)}`).join("\n") + "\n");
		await this.box.files().writeFile(`/tmp/hive-fetch-one-${tag}.sh`, FETCH_ONE);
		const fetchStart = Date.now();
		const f = await this.run(`xargs -P ${FETCH_PARALLELISM} -L 1 bash /tmp/hive-fetch-one-${tag}.sh < /tmp/hive-forks-${tag}; rm -f /tmp/hive-forks-${tag} /tmp/hive-fetch-one-${tag}.sh`, 10 * 60 * 1000);
		const lines = f.stdout.split("\n").map((l) => l.split("\t"));
		const fetched = new Set(lines.filter(([t]) => t === "MS").map(([, fork]) => fork));
		const failed = new Map(lines.filter(([t]) => t === "FAIL").map(([, fork, err]) => [fork, err] as const));
		// A fork with no result at all (the script itself failed) counts as unavailable too.
		const unavailable = forks
			.filter((fork) => !fetched.has(fork))
			.map((fork) => {
				const err = failed.get(fork);
				return { fork, error: err ? new TextDecoder().decode(Uint8Array.from(atob(err), (ch) => ch.charCodeAt(0))).trim().slice(-500) : `no result: ${(f.stderr || f.stdout).slice(-200)}` };
			});
		const ms = lines
			.filter(([t]) => t === "MS")
			.map(([, , v]) => Number(v))
			.sort((a, b) => a - b);
		console.log(
			`merge box: fetched ${ms.length}/${forks.length} forks in ${Date.now() - fetchStart}ms` + (ms.length ? ` (each p50 ${ms[ms.length >> 1]}ms, max ${ms.at(-1)}ms)` : ""),
			unavailable.slice(0, 2),
		);
		return { unavailable };
	}

	// Run the repository's checks on trunk itself: what an agent's change will be measured against.
	// Useful straight after an import, to see that Hive can build and test the repository.
	async checkTrunk(input: { repo: string; security?: boolean }) {
		await this.prepare({ repo: input.repo, canPush: false });
		await this.run("git checkout -q -f --detach origin/main && git clean -qfd");
		const t0 = Date.now();
		const shell = { exec: (command: string, timeoutMs?: number) => this.run(command, timeoutMs), write: (path: string, content: string) => this.box.files().writeFile(path, content) };
		const { plan, runs } = await gatherEvidence(shell, { security: input.security, baseRef: "origin/main" });
		const head = (await this.run("git rev-parse HEAD")).stdout.trim();
		return { commit: head, plan, runs, ms: Date.now() - t0 };
	}

	// Bring an existing repository in: clone it from its host (GitHub or any git server) and push it
	// to the empty trunk as main, whatever its default branch was called. A token for a private
	// repository is passed as a per-command HTTP header: never in a URL, a command line or storage.
	// Runs in its own box (repo:import), whose only reachable hosts are the source's and trunk.
	async importRepo(input: { repo: string; url: string; branch?: string; token?: string }): Promise<{ head: string; commits: number; files: number }> {
		const trunk = await repoHost(this.env).get(input.repo);
		if (!trunk) throw new Error(`trunk ${input.repo} missing`);
		const source = new URL(input.url);
		if (source.protocol !== "https:") throw new Error("import needs an https:// git URL");
		await this.box.ensure({ repos: [{ name: input.repo, scope: "write" }], hosts: [source.hostname] });
		const env: Record<string, string> = {};
		if (input.token) {
			env.GIT_CONFIG_COUNT = "1";
			env.GIT_CONFIG_KEY_0 = "http.extraHeader";
			env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${btoa(`x-access-token:${input.token}`)}`;
		}
		const dir = "/tmp/hive-import";
		const branch = input.branch ? `--branch ${sh(input.branch)}` : "";
		const r = await this.box.run(
			`set -e
			rm -rf ${dir}
			git clone -q --single-branch --no-tags ${branch} ${sh(input.url)} ${dir} 2>&1
			cd ${dir}
			git push -q ${sh(containerRemote(this.env, trunk.remote))} HEAD:refs/heads/main 2>&1
			printf 'HEAD\t%s\t%s\t%s\n' "$(git rev-parse HEAD)" "$(git rev-list --count HEAD)" "$(git ls-files | wc -l)"
			cd / && rm -rf ${dir}`,
			{ cwd: "/tmp", env, timeoutMs: 20 * 60 * 1000 },
		);
		const line = r.stdout.split("\n").find((l) => l.startsWith("HEAD\t"));
		if (r.exitCode !== 0 || !line) {
			const why = (r.stdout + r.stderr).replace(/Authorization: Basic \S+/g, "Authorization: Basic ***").trim().slice(-800);
			throw new Error(`import failed: ${why || `exit ${r.exitCode}`}`);
		}
		const [, head, commits, files] = line.split("\t");
		return { head, commits: Number(commits), files: Number(files) };
	}

	// Forks the container doesn't have (it restarted since they were fetched) are fetched again.
	private async ensureForks(forks: string[]) {
		await this.ready();
		const list = forks.map((f) => sh(`refs/remotes/${f}/main`)).join(" ");
		const r = await this.run(`for r in ${list}; do git rev-parse -q --verify "$r" >/dev/null || echo "$r"; done`);
		const missing = r.stdout.split("\n").filter(Boolean).map((ref) => ref.replace(/^refs\/remotes\//, "").replace(/\/main$/, ""));
		if (missing.length === 0) return;
		const { unavailable } = await this.fetchForks(missing);
		if (unavailable.length) throw new Error(`couldn't re-fetch ${unavailable.length} forks: ${unavailable[0].fork}: ${unavailable[0].error}`);
	}

	// Stack each change's own commits (merge-base..fork) onto trunk, in order. Changes that don't
	// apply are skipped and reported with conflict excerpts; the rest carry on. The whole loop runs
	// as one script in the container: one round trip per batch instead of several per change.
	// With `onto`, the changes go on top of that commit (an earlier verified stack in this
	// container) instead of trunk; returns null if the container no longer has it.
	async stack(entries: StackEntry[], onto?: string): Promise<StackResult | null> {
		await this.ensureForks(entries.map((e) => e.fork));
		await this.box.files().writeFile("/tmp/hive-stack.sh", STACK_SCRIPT);
		await this.box.files().writeFile("/tmp/hive-union.cjs", UNION_SCRIPT);
		await this.box.files().writeFile("/tmp/hive-stack.in", entries.map((e) => `${e.changeId} ${e.fork}`).join("\n") + "\n");
		const r = await this.run(`${onto ? `ONTO=${sh(onto)} ` : ""}bash /tmp/hive-stack.sh < /tmp/hive-stack.in`, 10 * 60 * 1000);
		if (r.exitCode !== 0) throw new Error(`stacking failed: ${r.stderr || r.stdout}`);
		const b64 = (x: string) => (x ? new TextDecoder().decode(Uint8Array.from(atob(x), (c) => c.charCodeAt(0))) : "");
		let trunk = "";
		let tip = "";
		const out: Stacked[] = [];
		for (const line of r.stdout.split("\n")) {
			const [tag, ...f] = line.split("\t");
			if (tag === "NOBASE") return null;
			if (tag === "TRUNK") {
				trunk = f[0];
				tip = onto ?? f[0];
			} else if (tag === "OK") {
				const unioned = b64(f[4] ?? "").split("\n").filter(Boolean);
				out.push({ changeId: f[0], ok: true, prev: f[1], tip: f[2], files: b64(f[3]).split("\n").filter(Boolean), ...(unioned.length ? { unioned } : {}) });
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
		const diff = (await this.run(`git diff ${range} | head -c 400000`)).stdout;
		const structuralDiff = (await this.run(`GIT_EXTERNAL_DIFF='difft --color never --display inline' git diff --ext-diff ${range} | head -c 30000`)).stdout;
		return { diff, structuralDiff };
	}

	// vai's third conflict level, per change: did trunk change code that calls what this change
	// modified (or vice versa) since the change's base?
	async referential(fork: string): Promise<ReferentialConflict[]> {
		await this.ensureForks([fork]);
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
		await this.prepare({ repo: input.repo, canPush: false });
		const r = await this.run(`hive-merge index --rev ${sh(input.commit)}`, 5 * 60 * 1000);
		if (r.exitCode !== 0) throw new Error(`hive-merge index failed: ${r.stderr}`);
		return JSON.parse(r.stdout) as SemanticIndex;
	}

	// Deterministic evidence for the current checkout: whatever package.json declares.
	// Dependencies are reinstalled only when the lockfile or manifest changed.
	// Setup and checks from the repository's evidence plan (hive.json, or detected for Node, Rust,
	// Python and Go), plus the security scan compared with trunk when it's on.
	async evidence(opts: { security?: boolean } = {}): Promise<EvidenceRun[]> {
		const shell = { exec: (command: string, timeoutMs?: number) => this.run(command, timeoutMs), write: (path: string, content: string) => this.box.files().writeFile(path, content) };
		const { plan, runs } = await gatherEvidence(shell, { security: opts.security, baseRef: "origin/main" });
		if (plan.source === "none") console.warn("merge box: this repository has no checks; add hive.json");
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

	// Bring every fork mirror up to trunk, so new changes fork from current code.
	async refreshMirrors(): Promise<{ refreshed: number; failed: string[] }> {
		const failed: string[] = [];
		const c = await this.ready();
		const entries = c.mirrors.map((name) => [name, this.sibling(c, name)] as const);
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
