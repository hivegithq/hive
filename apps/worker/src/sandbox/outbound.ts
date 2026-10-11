import { WorkerEntrypoint } from "cloudflare:workers";
import { repoHost, tokenSecret } from "../repo/index.ts";
import type { OutboundPolicy } from "./box.ts";

// Every HTTP(S) request a sandbox makes lands here. Git traffic to allowed repos gets a
// freshly minted, repo-scoped token attached; everything else is denied unless allowlisted.
// The container itself never sees a credential.
export class Outbound extends WorkerEntrypoint<Env, OutboundPolicy> {
	async fetch(request: Request): Promise<Response> {
		const policy = this.ctx.props;
		const url = new URL(request.url);
		const repo = this.gitRepoFor(url);

		if (repo) {
			const grant = policy.repos.find((r) => r.name === repo);
			if (!grant) return deny(`repo ${repo} is not granted to this sandbox`);
			const isPush = url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
			if (isPush && grant.scope !== "write") return deny(`repo ${repo} is read-only for this sandbox`);

			const token = await cachedToken(this.env, repo, grant.scope);
			const headers = new Headers(request.headers);
			headers.set("authorization", `Basic ${btoa(`x:${tokenSecret(token)}`)}`);
			return fetch(this.upstream(url), { method: request.method, headers, body: request.body, redirect: "manual" });
		}

		if (policy.hosts.includes(url.hostname)) return fetch(request);
		return deny(`${url.hostname} is not on this sandbox's allowlist`);
	}

	// Artifacts: https://<acct>.artifacts.cloudflare.net/git/<ns>/<repo>.git/...
	// devhost:   http://host.docker.internal:8788/git/dev/<repo>.git/...
	private gitRepoFor(url: URL): string | null {
		const isArtifacts = url.hostname.endsWith(".artifacts.cloudflare.net");
		const isDevhost = this.env.REPO_HOST !== "artifacts" && url.origin === new URL(this.env.DEVHOST_CONTAINER_URL).origin;
		if (!isArtifacts && !isDevhost) return null;
		const m = /^\/git\/[^/]+\/([^/]+)\.git(\/|$)/.exec(url.pathname);
		return m ? decodeURIComponent(m[1]) : null;
	}

	private upstream(url: URL): string {
		if (this.env.REPO_HOST === "artifacts") return url.toString();
		return url.toString().replace(new URL(this.env.DEVHOST_CONTAINER_URL).origin, new URL(this.env.DEVHOST_URL).origin);
	}
}

// A git clone or push is several HTTP requests; minting a token for each would spend the
// namespace's control-plane budget. Tokens are cached in this isolate (never in a container)
// and reused until two minutes before they expire.
const TOKEN_TTL_S = 900;
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function cachedToken(env: Env, repo: string, scope: "read" | "write"): Promise<string> {
	const key = `${scope}:${repo}`;
	const hit = tokens.get(key);
	if (hit && hit.expiresAt - Date.now() > 120_000) return hit.token;
	const token = await repoHost(env).token(repo, scope, TOKEN_TTL_S);
	tokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_S * 1000 });
	if (tokens.size > 10_000) tokens.delete(tokens.keys().next().value!);
	return token;
}

const deny = (reason: string) => new Response(`hive outbound: ${reason}\n`, { status: 403 });
