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

	async fork(source: string, name: string, description?: string): Promise<RepoHandle> {
		using repo = await this.artifacts.get(source);
		const r = await repo.fork(name, { description, defaultBranchOnly: true });
		return { name: r.name, remote: r.remote, defaultBranch: r.defaultBranch };
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
