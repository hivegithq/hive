import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

// Bring your own model: any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together, Groq, a local
// Ollama or vLLM...) with its key. A deployment sets OPENAI_API_KEY and, for anything other than
// OpenAI, OPENAI_BASE_URL. Its models are named byo/<id>, for example byo/gpt-5 or
// byo/meta-llama/llama-3.3-70b-instruct:free.

export const BYO = "byo/";
export const isByo = (model: string) => model.startsWith(BYO);
export const byoModelId = (model: string) => model.slice(BYO.length);

export interface ByoEnv {
	OPENAI_API_KEY?: string;
	OPENAI_BASE_URL?: string;
	// What the endpoint charges per million tokens, so Hive can count the cost (0 when unset).
	BYO_INPUT_USD_PER_M?: string;
	BYO_OUTPUT_USD_PER_M?: string;
}

export const byoBaseUrl = (env: ByoEnv) => (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

export function byoModel(env: ByoEnv, model: string): LanguageModel {
	if (!env.OPENAI_API_KEY) throw new Error("no model endpoint is set up on this deployment (OPENAI_API_KEY, and OPENAI_BASE_URL for anything but OpenAI)");
	return createOpenAICompatible({ name: "byo", baseURL: byoBaseUrl(env), apiKey: env.OPENAI_API_KEY })(byoModelId(model));
}

export function byoCost(env: ByoEnv, inputTokens: number, outputTokens: number): number {
	const rate = (v?: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
	return (inputTokens * rate(env.BYO_INPUT_USD_PER_M) + outputTokens * rate(env.BYO_OUTPUT_USD_PER_M)) / 1_000_000;
}

// The endpoint's /models list as the pickers show it. Endpoints that don't offer one give nothing.
export async function listByoModels(env: ByoEnv): Promise<{ id: string; label: string }[]> {
	if (!env.OPENAI_API_KEY) return [];
	const res = await fetch(`${byoBaseUrl(env)}/models`, { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` } });
	if (!res.ok) return [];
	const body = (await res.json()) as { data?: { id?: string }[] };
	return (body.data ?? [])
		.flatMap((m) => (typeof m.id === "string" ? [m.id] : []))
		.sort()
		.slice(0, 300)
		.map((id) => ({ id: `${BYO}${id}`, label: id }));
}
