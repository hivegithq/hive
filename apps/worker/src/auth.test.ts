import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actor, clerkFrontendApi } from "./auth.ts";

// Workers has crypto.subtle.timingSafeEqual; Node doesn't.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
subtle.timingSafeEqual ??= (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const KEY = `pk_live_${btoa("clerk.hivegit.dev$")}`;
const req = (token?: string) => new Request("https://hivegit.dev/api/repos", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("clerkFrontendApi", () => {
	it("decodes the Frontend API host from a publishable key", () => {
		expect(clerkFrontendApi(KEY)).toBe("clerk.hivegit.dev");
		expect(clerkFrontendApi("nope")).toBeNull();
		expect(clerkFrontendApi(undefined)).toBeNull();
	});
});

describe("actor", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("accepts the owner's token and nothing else without Clerk", async () => {
		const env = { HIVE_TOKEN: "secret-token", REPO_HOST: "artifacts" };
		expect(await actor(req("secret-token"), env)).toEqual({ kind: "owner" });
		expect(await actor(req("wrong-token!"), env)).toBeNull();
		expect(await actor(req(), env)).toBeNull();
	});

	it("is open only in devhost mode with nothing configured", async () => {
		expect(await actor(req(), { REPO_HOST: "devhost" })).toEqual({ kind: "open" });
		expect(await actor(req(), { REPO_HOST: "artifacts" })).toBeNull();
	});

	it("accepts a Clerk session token signed by the instance, for this site only", async () => {
		const { publicKey, privateKey } = await generateKeyPair("RS256");
		const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
		vi.stubGlobal("fetch", async () => Response.json({ keys: [jwk] }));
		const sign = (claims: Record<string, unknown>, issuer = "https://clerk.hivegit.dev") =>
			new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setSubject("user_1").setIssuedAt().setExpirationTime("1m").sign(privateKey);
		const env = { HIVE_TOKEN: "secret-token", CLERK_PUBLISHABLE_KEY: KEY, REPO_HOST: "artifacts" };

		expect(await actor(req(await sign({ azp: "https://hivegit.dev" })), env)).toEqual({ kind: "user", id: "user_1" });
		expect(await actor(req(await sign({ azp: "https://www.hivegit.dev" })), env)).toEqual({ kind: "user", id: "user_1" });
		expect(await actor(req(await sign({ azp: "https://evil.example" })), env)).toBeNull();
		expect(await actor(req(await sign({ azp: "https://hivegit.dev" }, "https://clerk.other.dev")), env)).toBeNull();
		expect(await actor(req(await sign({ azp: "https://hivegit.dev", sts: "pending" })), env)).toBeNull();
	});
});
