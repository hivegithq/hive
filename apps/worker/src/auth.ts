import { createRemoteJWKSet, jwtVerify } from "jose";

// Who may make changes. Two ways in:
//   - the deployment's HIVE_TOKEN, as a Bearer token (the owner's API, MCP and CLI use);
//   - a Clerk session token, when CLERK_PUBLISHABLE_KEY is set (people signed in on the site).
//     The Clerk instance runs in waitlist mode, so anyone who can sign in was let in by the owner.
// Session tokens are checked against the instance's public keys (JWKS); no Clerk secret is needed.
// In devhost mode with no HIVE_TOKEN configured, everything is open.

interface AuthEnv {
	HIVE_TOKEN?: string;
	CLERK_PUBLISHABLE_KEY?: string;
	REPO_HOST: string;
}

export type Actor = { kind: "owner" } | { kind: "user"; id: string } | { kind: "open" };

const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

function sameSecret(given: string, token: string) {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(token);
	return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

// pk_live_<base64("clerk.example.com$")> → clerk.example.com
export function clerkFrontendApi(key: string | undefined): string | null {
	const m = key?.match(/^pk_(?:live|test)_(.+)$/);
	if (!m) return null;
	try {
		return atob(m[1]).replace(/\$$/, "") || null;
	} catch {
		return null;
	}
}

let jwks: { api: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;

async function clerkUser(token: string, env: AuthEnv): Promise<string | null> {
	const api = clerkFrontendApi(env.CLERK_PUBLISHABLE_KEY);
	if (!api || token.split(".").length !== 3) return null;
	if (jwks?.api !== api) jwks = { api, keys: createRemoteJWKSet(new URL(`https://${api}/.well-known/jwks.json`)) };
	try {
		const { payload } = await jwtVerify(token, jwks.keys, { issuer: `https://${api}`, clockTolerance: 5 });
		// The token must have been issued to a page on this site (clerk.example.com → example.com).
		const site = api.replace(/^clerk\./, "");
		if (typeof payload.azp === "string") {
			const host = new URL(payload.azp).hostname;
			if (host !== site && !host.endsWith(`.${site}`)) return null;
		}
		if (payload.sts === "pending") return null;
		return typeof payload.sub === "string" ? payload.sub : null;
	} catch {
		return null;
	}
}

export async function actor(req: Request, env: AuthEnv): Promise<Actor | null> {
	const token = env.HIVE_TOKEN;
	if (!token && !env.CLERK_PUBLISHABLE_KEY) return env.REPO_HOST !== "artifacts" ? { kind: "open" } : null;
	const given = bearer(req);
	if (!given) return null;
	if (token && sameSecret(given, token)) return { kind: "owner" };
	const user = await clerkUser(given, env);
	return user ? { kind: "user", id: user } : null;
}
