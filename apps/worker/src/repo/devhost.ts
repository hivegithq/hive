import type { CommitInfo, RepoHandle, RepoHost } from "./host.ts";

// Client for tools/devhost: a local stand-in for Artifacts with the same operations.
export class DevRepoHost implements RepoHost {
	private readonly baseUrl: string;
	constructor(baseUrl: string) {
		this.baseUrl = baseUrl;
	}

	private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(new URL(path, this.baseUrl), {
			method,
			headers: body ? { "content-type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
		if (res.status === 404) return null as T;
		if (!res.ok) throw new Error(`devhost ${method} ${path}: ${res.status} ${await res.text()}`);
		return (await res.json()) as T;
	}

	create(name: string, description?: string) {
		return this.call<RepoHandle>("POST", "/api/repos", { name, description });
	}
	fork(source: string, name: string, description?: string) {
		return this.call<RepoHandle>("POST", `/api/repos/${enc(source)}/fork`, { name, description });
	}
	get(name: string) {
		return this.call<RepoHandle | null>("GET", `/api/repos/${enc(name)}`);
	}
	async token(name: string, scope: "read" | "write", ttlSeconds: number) {
		const t = await this.call<{ plaintext: string } | null>("POST", `/api/repos/${enc(name)}/tokens`, { scope, ttl: ttlSeconds });
		if (!t) throw new Error(`devhost has no repository ${name} (was .devhost cleared? seed it again)`);
		return t.plaintext;
	}
	async log(name: string, opts: { ref?: string; limit?: number } = {}) {
		const q = new URLSearchParams({ ref: opts.ref ?? "main", limit: String(opts.limit ?? 50) });
		return (await this.call<CommitInfo[] | null>("GET", `/api/repos/${enc(name)}/log?${q}`)) ?? [];
	}
	async readFile(name: string, ref: string, path: string) {
		const res = await fetch(new URL(`/api/repos/${enc(name)}/file?${new URLSearchParams({ ref, path })}`, this.baseUrl));
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`devhost readFile ${name}:${path}: ${res.status}`);
		return res.text();
	}
	async listFiles(name: string, ref: string) {
		return (await this.call<string[] | null>("GET", `/api/repos/${enc(name)}/files?${new URLSearchParams({ ref })}`)) ?? [];
	}
}

const enc = encodeURIComponent;
