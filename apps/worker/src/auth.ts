// A self-hosted instance accepts writes from its owner token. Local devhost mode without a token
// stays open so the included development setup works without authentication.

interface AuthEnv {
	HIVE_TOKEN?: string;
	REPO_HOST: string;
}

export type Actor = { kind: "owner" } | { kind: "open" };

const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

async function sameSecret(given: string, token: string) {
	const encoder = new TextEncoder();
	const [givenHash, tokenHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(given)),
		crypto.subtle.digest("SHA-256", encoder.encode(token)),
	]);
	return crypto.subtle.timingSafeEqual(givenHash, tokenHash);
}

export async function actor(req: Request, env: AuthEnv): Promise<Actor | null> {
	const token = env.HIVE_TOKEN;
	if (!token) return env.REPO_HOST !== "artifacts" ? { kind: "open" } : null;
	const given = bearer(req);
	if (!given) return null;
	if (await sameSecret(given, token)) return { kind: "owner" };
	return null;
}
