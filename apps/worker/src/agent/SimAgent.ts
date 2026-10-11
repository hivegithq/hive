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
}

const DIR = "/work";
const AUTHOR = { name: "hive sim", email: "sim@agents.hive" };

export class SimAgent extends Agent<Env, SimState> {
	initialState: SimState = { repo: "", changeId: "", kind: "disjoint", attempts: 0, phase: "idle", error: null };

	async start(input: { repo: string; changeId: string; kind: SimKind }) {
		this.setState({ ...this.initialState, ...input, phase: "working" });
		await this.schedule(0, "work");
	}

	async onBounced(_reason: string) {
		if (this.state.attempts >= 3) return this.setState({ ...this.state, phase: "failed", error: "bounced too often" });
		this.setState({ ...this.state, phase: "working" });
		await this.schedule(1, "work");
	}

	onLanded(_commit: string) {
		this.setState({ ...this.state, phase: "done" });
	}

	release() {}

	async work() {
		this.ctx.waitUntil(this.keepAliveWhile(() => this.run()).catch((err) => this.setState({ ...this.state, phase: "failed", error: String(err) })));
	}

	private async run() {
		const { repo, changeId, kind } = this.state;
		const coordinator = coordinatorOf(this.ctx.exports, repo);
		const detail = await coordinator.changeDetail(changeId);
		if (!detail) throw new Error(`unknown change ${changeId}`);
		const host = repoHost(this.env);
		const fs = new MemoryFS();
		const [fork, trunk] = await Promise.all([host.get(detail.change.fork), host.get(repo)]);
		if (!fork || !trunk) throw new Error("fork or trunk missing");
		const forkAuth = { username: "x", password: tokenSecret(await host.token(detail.change.fork, "write", 600)) };

		// Always build the edit on current trunk (a retry after a bounce is a fresh rebase).
		const trunkAuth = { username: "x", password: tokenSecret(await host.token(repo, "read", 600)) };
		await git.clone({ fs, http, dir: DIR, url: trunk.remote, ref: "main", singleBranch: true, onAuth: () => trunkAuth });

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
		await git.push({ fs, http, dir: DIR, url: fork.remote, ref: "main", remoteRef: "main", force: true, onAuth: () => forkAuth });

		this.setState({ ...this.state, attempts: this.state.attempts + 1, phase: "submitted" });
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
