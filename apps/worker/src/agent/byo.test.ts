import { describe, expect, it } from "vitest";
import { byoBaseUrl, byoCost, byoModelId, isByo } from "./byo.ts";

describe("bring your own model", () => {
	it("names models byo/<id>, keeping the endpoint's own slashes", () => {
		expect(isByo("byo/gpt-5")).toBe(true);
		expect(isByo("@cf/qwen/qwen3.8-27b")).toBe(false);
		expect(byoModelId("byo/meta-llama/llama-3.3-70b-instruct:free")).toBe("meta-llama/llama-3.3-70b-instruct:free");
	});

	it("defaults to OpenAI and trims trailing slashes", () => {
		expect(byoBaseUrl({})).toBe("https://api.openai.com/v1");
		expect(byoBaseUrl({ OPENAI_BASE_URL: "https://openrouter.ai/api/v1/" })).toBe("https://openrouter.ai/api/v1");
	});

	it("counts cost from the configured prices, and is free when there are none", () => {
		expect(byoCost({}, 1_000_000, 1_000_000)).toBe(0);
		expect(byoCost({ BYO_INPUT_USD_PER_M: "1", BYO_OUTPUT_USD_PER_M: "4" }, 500_000, 250_000)).toBeCloseTo(1.5);
	});
});

describe("the endpoint", () => {
	it("runs a tool-calling loop against an OpenAI-compatible server", async () => {
		const { generateText, isStepCount, tool } = await import("ai");
		const { z } = await import("zod");
		const { byoModel } = await import("./byo.ts");
		const seen: { url: string; auth: string | null; body: { model: string; tools?: unknown[] } }[] = [];
		const reply = (message: object) => new Response(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }), { headers: { "content-type": "application/json" } });
		const real = globalThis.fetch;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
			return seen.length === 1
				? reply({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ping", arguments: "{\"n\":2}" } }] })
				: reply({ role: "assistant", content: "done" });
		}) as typeof fetch;
		try {
			let got = 0;
			const r = await generateText({
				model: byoModel({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://llm.example/v1" }, "byo/org/some-model"),
				prompt: "go",
				tools: { ping: tool({ description: "ping", inputSchema: z.object({ n: z.number() }), execute: async ({ n }) => { got = n; return "pong"; } }) },
				stopWhen: [isStepCount(3)],
			});
			expect(got).toBe(2);
			expect(r.text).toBe("done");
			expect(seen[0].url).toBe("https://llm.example/v1/chat/completions");
			expect(seen[0].auth).toBe("Bearer k");
			expect(seen[0].body.model).toBe("org/some-model");
			expect(seen[0].body.tools).toHaveLength(1);
		} finally {
			globalThis.fetch = real;
		}
	});
});
