import { describe, expect, it } from "vitest";
import { camelModelId, isCamel, isTransientRun, pickModels, runBody, signAgent, toolsUrl, verifyAgent } from "./camel.ts";

describe("camel", () => {
	it("tells camel models from Workers AI ones", () => {
		expect(isCamel("camel/openrouter/cohere/north-mini-code:free")).toBe(true);
		expect(isCamel("@cf/moonshotai/kimi-k2.7-code")).toBe(false);
		expect(camelModelId("camel/openrouter/cohere/north-mini-code:free")).toBe("openrouter/cohere/north-mini-code:free");
	});

	it("signs one agent's tool URL, and only that agent's", async () => {
		const sig = await signAgent("secret", "a-123");
		expect(await verifyAgent("secret", "a-123", sig)).toBe(true);
		expect(await verifyAgent("secret", "a-124", sig)).toBe(false);
		expect(await verifyAgent("other", "a-123", sig)).toBe(false);
		expect(await verifyAgent("secret", "a-123", `${sig.slice(0, -1)}0`)).toBe(sig.endsWith("0"));
		expect(toolsUrl("https://hivegit.dev/", "a-123", sig)).toBe(`https://hivegit.dev/camel/mcp/a-123/${sig}`);
	});

	it("retries busy-provider failures but not real ones", () => {
		expect(isTransientRun({ code: "model_error", message: "openrouter API error (429): Rate limit exceeded. High demand" })).toBe(true);
		expect(isTransientRun("model_stream_stalled")).toBe(true);
		expect(isTransientRun({ code: "spend_limit", message: "the run's spend limit was reached" })).toBe(false);
		expect(isTransientRun(null)).toBe(false);
	});

	it("builds a run that serves Hive's tools with a spend cap", () => {
		const b = runBody({ model: "openrouter/x:free", system: "sys", input: "go", toolsUrl: "https://h/camel/mcp/a/s", spendUsd: 0.5 });
		expect(b.spendLimit).toEqual({ usd: 0.5 });
		expect(b.mcpServers[0]).toMatchObject({ name: "hive", url: "https://h/camel/mcp/a/s" });
		expect(b.wait).toBe(false);
	});

	it("offers free, tool-capable, roomy models first", () => {
		const m = pickModels([
			{ id: "anthropic/claude-x", provider: "anthropic", cost: { input: 3, output: 15 }, toolCallStreaming: true, contextWindow: 200000 },
			{ id: "openrouter/a:free", provider: "openrouter", cost: { input: 0, output: 0 }, toolCallStreaming: true, contextWindow: 262144 },
			{ id: "openrouter/b:free", provider: "openrouter", cost: { input: 0, output: 0 }, toolCallStreaming: false, contextWindow: 262144 },
			{ id: "openrouter/c:free", provider: "openrouter", cost: { input: 0, output: 0 }, toolCallStreaming: "unknown", contextWindow: 8000 },
		]);
		expect(m.map((x) => x.id)).toEqual(["camel/openrouter/a:free", "camel/anthropic/claude-x"]);
		expect(m[0].free).toBe(true);
	});
});
