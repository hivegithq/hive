import { Agent } from "agents";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { coordinatorOf } from "../bindings.ts";
import { MemoryFS } from "../ledger/memfs.ts";
import { repoHost, tokenSecret } from "../repo/index.ts";

// A simulated agent for load tests: no container, no model. It does what a coding agent does to the
// version-control system (clone its fork, declare intent, commit, push, submit, fix on bounce) with
// isomorphic-git in memory, so thousands can run at once and measure Hive itself rather than LLMs.

export type SimKind = "disjoint" | "shared" | "broken";

interface SimState {
	repo: string;
	changeId: string;
	kind: SimKind;
	attempts: number;
	phase: "idle" | "working" | "submitted" | "done" | "failed";
	error: string | null;
	since: number; // when the current phase began
	retries?: number; // transient failures retried so far
}

const MAX_RETRIES = 5;

// Work that hasn't finished in this long was lost (an eviction or a deploy) and may be redone.
const STALE_MS = 3 * 60 * 1000;

const DIR = "/work";

// Label errors with the step that failed, so a load test says where git hosting pushed back.
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		// isomorphic-git keeps the server's response body on HttpError: that's where the reason is.
		const body = (err as { data?: { response?: unknown } }).data?.response;
		throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}${body ? ` (${String(body).slice(0, 300)})` : ""}`);
	}
}
const AUTHOR = { name: "hive sim", email: "sim@agents.hive" };

export class SimAgent extends Agent<Env, SimState> {
	initialState: SimState = { repo: "", changeId: "", kind: "disjoint", attempts: 0, phase: "idle", error: null, since: 0 };

	async start(input: { repo: string; changeId: string; kind: SimKind }) {
		this.setState({ ...this.initialState, ...input, phase: "working", since: Date.now() });
		await this.schedule(0, "work");
	}

	// Bounces can be delivered twice (the coordinator's heartbeat re-sends ones that may have been
	// lost), so a delivery while fresh work is under way is ignored.
	async onBounced(_reason: string) {
		if (this.state.phase === "working" && Date.now() - this.state.since < STALE_MS) return;
		if (this.state.attempts >= 3) return this.setState({ ...this.state, phase: "failed", error: "bounced too often" });
		this.setState({ ...this.state, phase: "working", since: Date.now(), retries: 0 });
		await this.schedule(1, "work");
	}

	// Heartbeat for a change still drafting: redo work that was lost, or that gave up on errors
	// (the change is still waiting, so it's worth another round of retries).
	async ping() {
		const { phase, since } = this.state;
		if (phase === "working" && Date.now() - since < STALE_MS) return;
		if (phase !== "working" && phase !== "failed") return;
		if (phase === "failed" && Date.now() - since < STALE_MS) return;
		this.setState({ ...this.state, phase: "working", since: Date.now(), retries: 0 });
		await this.schedule(0, "work");
	}

	onLanded(_commit: string) {
		this.setState({ ...this.state, phase: "done" });
	}

	release() {}

	status(): SimState {
		return this.state;
	}

	async work() {
		this.ctx.waitUntil(this.keepAliveWhile(() => this.run()).catch((err) => this.failed(err)));
	}

	// Under load, git hosting answers with the odd 5xx or dropped connection. Back off and redo the
	// work (it starts from a fresh clone, so it's safe to repeat) before giving up.
	private async failed(err: unknown) {
		const retries = (this.state.retries ?? 0) + 1;
		if (retries <= MAX_RETRIES && /\b5\d\d\b|network|connection|timed? ?out|reset/i.test(String(err))) {
			this.setState({ ...this.state, retries, error: String(err), since: Date.now() });
			await this.schedule(Math.round(5 * 2 ** retries * (0.5 + Math.random())), "work");
			return;
		}
		this.setState({ ...this.state, phase: "failed", error: String(err), since: Date.now() });
	}

	private async run() {
		const { repo, changeId, kind } = this.state;
		const coordinator = coordinatorOf(this.ctx.exports, repo);
		const detail = await coordinator.changeDetail(changeId);
		if (!detail) throw new Error(`unknown change ${changeId}`);
		const host = repoHost(this.env);
		const fs = new MemoryFS();
		// Never read trunk itself: a repository is served from one place, and a thousand agents cloning
		// it at once is the hottest spot there is. The first attempt starts from the agent's own fork
		// (just forked from a fresh mirror); a retry after a bounce starts from a random mirror, which
		// every landed batch brings up to trunk.
		const mirrors = this.state.attempts > 0 ? await coordinator.mirrors() : [];
		const base = mirrors.length ? mirrors[Math.floor(Math.random() * mirrors.length)] : detail.change.fork;
		const [fork, source] = await Promise.all([host.get(detail.change.fork), host.get(base)]);
		if (!fork || !source) throw new Error(`fork or ${base} missing`);
		const forkAuth = { username: "x", password: tokenSecret(await host.token(detail.change.fork, "write", 600)) };
		const sourceAuth = base === fork.name ? forkAuth : { username: "x", password: tokenSecret(await host.token(base, "read", 600)) };
		await step(`clone ${base === fork.name ? "fork" : "mirror"}`, () =>
			git.clone({ fs, http, dir: DIR, url: source.remote, ref: "main", singleBranch: true, onAuth: () => sourceAuth }),
		);

		const { path, content, symbol } = this.edit(kind, changeId, String(await fs.promises.readFile(`${DIR}/shared/notes.ts`, "utf8").catch(() => "")));
		const t0 = Date.now();
		await coordinator.declareIntent(changeId, { summary: `${kind} edit by a simulated agent`, paths: [path], symbols: symbol ? [{ path, name: symbol }] : [] });
		coordinator.recordMetric("intent_ms", Date.now() - t0);

		await fs.promises.writeFile(`${DIR}/${path}`, content);
		await git.add({ fs, dir: DIR, filepath: path });
		await git.commit({
			fs,
			dir: DIR,
			author: AUTHOR,
			message: `${kind}: ${changeId}\n\nHive-Change-Id: ${changeId}\nHive-Goal: ${detail.change.goalId}\nHive-Agent: ${detail.change.agentId}\nHive-Model: sim\n`,
		});
		await step("push fork", () => git.push({ fs, http, dir: DIR, url: fork.remote, ref: "main", remoteRef: "main", force: true, onAuth: () => forkAuth }));

		this.setState({ ...this.state, attempts: this.state.attempts + 1, phase: "submitted", since: Date.now() });
		await coordinator.submit(changeId);
	}

	// disjoint: a new module of its own. shared: one more line in a file many agents touch (textual
	// overlaps, and merges mergiraf has to handle). broken: a module whose check fails, so the batch
	// has to find the culprit.
	private edit(kind: SimKind, changeId: string, shared: string): { path: string; content: string; symbol: string | null } {
		const name = changeId.replace(/[^a-z0-9]/gi, "_");
		if (kind === "shared") {
			const line = `export const ${name} = ${JSON.stringify(changeId)};\n`;
			return { path: "shared/notes.ts", content: shared + line, symbol: name };
		}
		const ok = kind === "broken" ? "false" : "true";
		return { path: `agents/${changeId}.ts`, content: `export function ok(): boolean {\n\treturn ${ok};\n}\n`, symbol: "ok" };
	}
}
