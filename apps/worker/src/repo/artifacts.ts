import type { CommitInfo, RepoHandle, RepoHost } from "./host.ts";

export class ArtifactsRepoHost implements RepoHost {
	private readonly artifacts: Artifacts;
	constructor(artifacts: Artifacts) {
		this.artifacts = artifacts;
	}

	async create(name: string, description?: string): Promise<RepoHandle> {
		const r = await this.artifacts.create(name, { description, setDefaultBranch: "main" });
		return { name: r.name, remote: r.remote, defaultBranch: r.defaultBranch };
	}

	// A repo can only be forked once at a time (FORK_IN_PROGRESS), so concurrent agents starting
	// on the same trunk wait their turn. Transient service errors get the same backoff.
	async fork(source: string, name: string, description?: string): Promise<RepoHandle> {
		for (let attempt = 0; ; attempt++) {
			try {
				using repo = await this.artifacts.get(source);
				const r = await repo.fork(name, { description, defaultBranchOnly: true });
				return { name: r.name, remote: r.remote, defaultBranch: r.defaultBranch };
			} catch (err) {
				const code = (err as { code?: string }).code;
				const retryable = code === "FORK_IN_PROGRESS" || code === "INTERNAL_ERROR" || code === "UPSTREAM_UNAVAILABLE";
				if (code === "ALREADY_EXISTS") {
					const existing = await this.get(name);
					if (existing) return existing; // an earlier attempt succeeded after all
				}
				if (!retryable || attempt >= 8) throw err;
				await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() / 2)));
			}
		}
	}

	async get(name: string): Promise<RepoHandle | null> {
		try {
			using repo = await this.artifacts.get(name);
			const info = await repo.info();
			return { name: info.name, remote: info.remote, defaultBranch: info.defaultBranch };
		} catch (err) {
			if ((err as { code?: string }).code === "NOT_FOUND") return null;
			throw err;
		}
	}

	async token(name: string, scope: "read" | "write", ttlSeconds: number): Promise<string> {
		using repo = await this.artifacts.get(name);
		return (await repo.createToken(scope, Math.max(60, ttlSeconds))).plaintext;
	}

	async log(name: string, opts: { ref?: string; limit?: number } = {}): Promise<CommitInfo[]> {
		using repo = await this.artifacts.get(name);
		const commits = await repo.log({ ref: opts.ref ?? "main", limit: opts.limit ?? 50 });
		return commits.map((c) => ({
			hash: c.hash,
			message: c.message,
			author: c.author,
			parents: c.parents,
			committedAt: c.committedAt,
		}));
	}

	async readFile(name: string, ref: string, path: string): Promise<string | null> {
		using repo = await this.artifacts.get(name);
		const blob = await repo.readFile({ ref, path });
		return blob ? blob.text() : null;
	}

	async listFiles(name: string, ref: string): Promise<string[]> {
		using repo = await this.artifacts.get(name);
		const [commit] = await repo.log({ ref, limit: 1 });
		if (!commit) return [];
		const files: string[] = [];
		const walk = async (treeHash: string, prefix: string) => {
			const entries = (await repo.readTree(treeHash)) ?? [];
			await Promise.all(
				entries.map(async (e) => {
					const path = prefix + e.name;
					if (e.type === "tree") await walk(e.hash, `${path}/`);
					else if (e.type === "blob" || e.type === "exec") files.push(path);
				}),
			);
		};
		await walk(commit.treeHash, "");
		return files.sort();
	}
}
