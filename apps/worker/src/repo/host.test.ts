import { describe, expect, it } from "vitest";
import { authenticatedRemote, parseTrailers, tokenSecret } from "./host.ts";

describe("parseTrailers", () => {
	it("reads trailers from the final paragraph", () => {
		const msg = "Free shipping over $50\n\nWhy: customers abandon carts at shipping.\n\nHive-Change-Id: c-1\nHive-Model: @cf/moonshotai/kimi-k2.7-code\n";
		expect(parseTrailers(msg)).toEqual({ "Hive-Change-Id": "c-1", "Hive-Model": "@cf/moonshotai/kimi-k2.7-code" });
	});

	it("never treats the subject as a trailer", () => {
		expect(parseTrailers("Shop: cart, pricing, discounts")).toEqual({});
	});
});

describe("tokens", () => {
	it("strips the expiry and embeds the secret for basic auth", () => {
		expect(tokenSecret("art_v1_abc?expires=123")).toBe("art_v1_abc");
		expect(authenticatedRemote("https://acct.artifacts.cloudflare.net/git/hive/shop.git", "art_v1_abc?expires=1")).toBe(
			"https://x:art_v1_abc@acct.artifacts.cloudflare.net/git/hive/shop.git",
		);
	});
});
