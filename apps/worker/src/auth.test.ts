import { describe, expect, it } from "vitest";
import { actor } from "./auth.ts";

// Workers has crypto.subtle.timingSafeEqual; Node doesn't.
const subtle = crypto.subtle as SubtleCrypto & {
	timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
};
subtle.timingSafeEqual ??= (left, right) => {
	const a = ArrayBuffer.isView(left) ? new Uint8Array(left.buffer, left.byteOffset, left.byteLength) : new Uint8Array(left);
	const b = ArrayBuffer.isView(right) ? new Uint8Array(right.buffer, right.byteOffset, right.byteLength) : new Uint8Array(right);
	return a.length === b.length && a.every((value, index) => value === b[index]);
};

const req = (token?: string) => new Request("https://hivegit.dev/api/repos", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("actor", () => {
	it("accepts the owner's token and rejects other credentials", async () => {
		const env = { HIVE_TOKEN: "secret-token", REPO_HOST: "artifacts" };
		expect(await actor(req("secret-token"), env)).toEqual({ kind: "owner" });
		expect(await actor(req("wrong-token!"), env)).toBeNull();
		expect(await actor(req(), env)).toBeNull();
	});

	it("is open only in devhost mode with nothing configured", async () => {
		expect(await actor(req(), { REPO_HOST: "devhost" })).toEqual({ kind: "open" });
		expect(await actor(req(), { REPO_HOST: "artifacts" })).toBeNull();
	});
});
