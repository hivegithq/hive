import { WorkerEntrypoint } from "cloudflare:workers";
import { coordinatorOf } from "../bindings.ts";
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
			const grant = policy.repos.find((r) => (r.name.endsWith("*") ? repo.startsWith(r.name.slice(0, -1)) : r.name === repo));
			if (!grant) return deny(`repo ${repo} is not granted to this sandbox`);
			const isPush = url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
			if (isPush && grant.scope !== "write") return deny(`repo ${repo} is read-only for this sandbox`);

			const token = await cachedToken(this.env, repo, grant.scope);
			const headers = new Headers(request.headers);
			headers.set("authorization", `Basic ${btoa(`x:${tokenSecret(token)}`)}`);
			// Git protocol bodies must pass through byte-for-byte. Buffer the request (git gzips large
			// negotiation bodies) and ask for an uncompressed response, so no layer in between
			// decodes one side and leaves the encoding header on it.
			headers.set("accept-encoding", "identity");
			const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
			// Reads (ref discovery, upload-pack) are safe to resend once if the connection drops; pushes are not.
			const send = () => fetch(this.upstream(url), { method: request.method, headers, body, redirect: "manual" });
			let upstream: Response;
			try {
				upstream = await send();
			} catch (err) {
				if (isPush) throw err;
				await new Promise((r) => setTimeout(r, 250));
				upstream = await send();
			}
			if (upstream.status >= 500 && !isPush) {
				await new Promise((r) => setTimeout(r, 500));
				upstream = await send();
			}
			if (!upstream.ok) console.warn(`hive outbound: ${request.method} ${repo}${url.pathname.slice(url.pathname.lastIndexOf("/"))} → ${upstream.status}`);
			return upstream;
		}

		if (policy.github && url.hostname === "github.com") {
			const { owner, repo: name, hive } = policy.github;
			const m = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
			if (!m || m[1].toLowerCase() !== owner.toLowerCase() || m[2].toLowerCase() !== name.toLowerCase()) {
				return deny(`only github.com/${owner}/${name} is reachable from this sandbox`);
			}
			const token = await coordinatorOf(this.ctx.exports, hive).githubToken();
			if (!token) return deny(`no GitHub token is connected for ${hive}`);
			const headers = new Headers(request.headers);
			headers.set("authorization", `Basic ${btoa(`x-access-token:${token}`)}`);
			headers.set("accept-encoding", "identity");
			const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
			return fetch(url.toString(), { method: request.method, headers, body, redirect: "manual" });
		}

		if (policy.hosts.includes(url.hostname)) {
			// Git over HTTP to an allowed host (an import from GitHub, say) gets the same treatment as
			// Artifacts traffic: a buffered body and an uncompressed response, so packs pass intact.
			if (/\/(info\/refs|git-upload-pack|git-receive-pack)$/.test(url.pathname)) {
				const headers = new Headers(request.headers);
				headers.set("accept-encoding", "identity");
				const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
				return fetch(url.toString(), { method: request.method, headers, body, redirect: "manual" });
			}
			return fetch(request);
		}
		return deny(`${url.hostname} is not on this sandbox's allowlist`);
	}

	// Artifacts: https://<acct>.artifacts.cloudflare.net/git/<ns>/<repo>.git/...
	// devhost:   http://devhost.hive.internal/git/dev/<repo>.git/... (DEVHOST_CONTAINER_URL)
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
