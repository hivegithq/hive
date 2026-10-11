// Everything Hive needs from a Git host. Production uses Cloudflare Artifacts;
// local dev uses tools/devhost (real git behind the same shape), because the
// Artifacts binding has no local simulation.

export interface RepoHandle {
	name: string;
	remote: string; // HTTPS smart-HTTP remote, no credentials
	defaultBranch: string;
}

export interface CommitInfo {
	hash: string;
	message: string;
	author: { name: string; email: string };
	parents: string[];
	committedAt: number; // unix seconds
}

export interface RepoHost {
	create(name: string, description?: string): Promise<RepoHandle>;
	fork(source: string, name: string, description?: string): Promise<RepoHandle>;
	get(name: string): Promise<RepoHandle | null>;
	// Full token string; use tokenSecret() for Git basic auth.
	token(name: string, scope: "read" | "write", ttlSeconds: number): Promise<string>;
	log(name: string, opts?: { ref?: string; limit?: number }): Promise<CommitInfo[]>;
	readFile(name: string, ref: string, path: string): Promise<string | null>;
	listFiles(name: string, ref: string): Promise<string[]>;
}

// Artifacts tokens look like `art_v1_<hex>?expires=<unix>`; Git basic auth wants only the secret.
export const tokenSecret = (token: string) => token.split("?expires=")[0];

export function authenticatedRemote(remote: string, token: string): string {
	const url = new URL(remote);
	url.username = "x";
	url.password = tokenSecret(token);
	return url.toString();
}

export async function head(host: RepoHost, name: string, ref = "main"): Promise<string | null> {
	const [latest] = await host.log(name, { ref, limit: 1 });
	return latest?.hash ?? null;
}

// Trailers parsed from a commit message: `Key: value` lines in the final paragraph,
// which must not be the subject paragraph (same rule as git interpret-trailers).
export function parseTrailers(message: string): Record<string, string> {
	const paragraphs = message.trim().split(/\n\s*\n/);
	if (paragraphs.length < 2) return {};
	const lines = paragraphs[paragraphs.length - 1].split("\n");
	const out: Record<string, string> = {};
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = /^([A-Za-z][A-Za-z0-9-]*): (.+)$/.exec(lines[i]);
		if (!m) break;
		out[m[1]] = m[2];
	}
	return out;
}
