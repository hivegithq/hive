import { describe, expect, it } from "vitest";
import { checkUrl, formatFor, type Notice, payload, sign } from "./notify.ts";

const n: Notice = { event: "needs-you", repo: "uuid", text: "c-1 needs your call", link: "https://hivegit.dev/r/uuid", changeId: "c-1", at: 1 };

describe("notify", () => {
	it("formats for Slack, Discord and plain JSON", () => {
		expect(JSON.parse(payload("slack", n)).text).toBe("*uuid*: c-1 needs your call <https://hivegit.dev/r/uuid|Open>");
		expect(JSON.parse(payload("discord", n)).content).toContain("**uuid**");
		expect(JSON.parse(payload("json", n))).toEqual(n);
	});

	it("signs like GitHub does (HMAC-SHA256, hex)", async () => {
		// echo -n 'hello' | openssl dgst -sha256 -hmac 'secret'
		expect(await sign("secret", "hello")).toBe("sha256=88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b");
	});

	it("accepts public https URLs only, and guesses the format", () => {
		expect(checkUrl("https://hooks.slack.com/services/x")).toBeNull();
		expect(checkUrl("http://example.com/hook")).toBe("webhooks must use https");
		expect(checkUrl("https://127.0.0.1/hook")).toBe("that host is private");
		expect(checkUrl("https://192.168.1.4/hook")).toBe("that host is private");
		expect(formatFor("https://hooks.slack.com/services/x")).toBe("slack");
		expect(formatFor("https://discord.com/api/webhooks/1/2")).toBe("discord");
		expect(formatFor("https://example.com/hive")).toBe("json");
	});
});
