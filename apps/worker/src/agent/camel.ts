// Running a coding agent on CamelAI (camelRun): any model in its catalog (Anthropic, OpenAI, and
// OpenRouter's free ones) works on a Hive goal. camelRun runs the model loop; Hive serves its agent
// tools (read, edit, run, checks, submit) to it as an MCP server, and each call lands in that
// change's own sandbox. https://run.camelai.com

export const CAMEL_PREFIX = "camel/";
export const isCamel = (model: string) => model.startsWith(CAMEL_PREFIX);
export const camelModelId = (model: string) => model.slice(CAMEL_PREFIX.length);
export const CAMEL_API = "https://run.camelai.com/v1";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
	return { key, mac: await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)) };
}

// The URL camelRun calls carries a signature for one agent: only a run Hive started can reach that
// agent's sandbox.
export async function signAgent(secret: string, agentId: string): Promise<string> {
	return hex((await hmac(secret, `camel:${agentId}`)).mac).slice(0, 48);
}

export async function verifyAgent(secret: string, agentId: string, sig: string): Promise<boolean> {
	const want = await signAgent(secret, agentId);
	return want.length === sig.length && want.split("").every((c, i) => c === sig[i]);
}

export const toolsUrl = (site: string, agentId: string, sig: string) => `${site.replace(/\/$/, "")}/camel/mcp/${agentId}/${sig}`;

export interface CamelRun {
	id: string;
	status: "running" | "completed" | "failed" | "input_required" | string;
	text: string | null;
	error: string | { code?: string; message?: string } | null;
	usage?: { responses?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number };
	toolCalls?: unknown[];
	toolErrors?: unknown[];
}

// A run's error as one line, whether camelRun sent a string or { code, message }.
export function errorText(error: CamelRun["error"]): string {
	if (!error) return "";
	if (typeof error === "string") return error;
	return [error.code, error.message].filter(Boolean).join(": ") || JSON.stringify(error);
}

// A failure worth another run rather than giving up: the model's provider was busy or hiccuped.
export const isTransientRun = (error: CamelRun["error"]) => /429|rate.?limit|high demand|overloaded|unavailable|timeout|stalled|temporar|5\d\d\b/i.test(errorText(error));

export function runBody(o: { model: string; system: string; input: string; toolsUrl: string; spendUsd: number }) {
	return {
		model: o.model,
		systemPrompt: o.system,
		input: [{ type: "text", text: o.input }],
		mcpServers: [{ name: "hive", url: o.toolsUrl, timeoutMs: 20 * 60_000 }],
		spendLimit: { usd: o.spendUsd },
		retentionSeconds: 3600,
		wait: false,
	};
}

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${CAMEL_API}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
	const text = await res.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	if (!res.ok && res.status !== 202) {
		const why = (body as { error?: string } | null)?.error ?? text.slice(0, 200);
		throw new Error(`CamelAI ${init.method ?? "GET"} ${path}: ${res.status} ${why}`);
	}
	return body as T;
}

export const startRun = (key: string, body: unknown) => call<CamelRun>(key, "/runs", { method: "POST", body: JSON.stringify(body) });
export const getRun = (key: string, id: string, waitSeconds = 25) => call<CamelRun>(key, `/runs/${id}?wait=${waitSeconds}`);
export const abortRun = (key: string, id: string) => call<unknown>(key, `/runs/${id}/abort`, { method: "POST", body: "{}" }).catch(() => {});

export interface CamelModel {
	id: string;
	name: string;
	provider: string;
	free: boolean;
	tools: boolean | "unknown";
	costIn: number; // USD per million tokens
	costOut: number;
	contextWindow: number;
}

// The catalog the account can use, trimmed to what Hive's picker needs. Free ones and ones known to
// support tool calls first.
export function pickModels(catalog: { id: string; name?: string; provider: string; cost?: { input: number; output: number }; toolCallStreaming?: boolean | string; contextWindow?: number }[]): CamelModel[] {
	const models = catalog.map((m) => ({
		id: `${CAMEL_PREFIX}${m.id}`,
		name: m.name ?? m.id.split("/").at(-1) ?? m.id,
		provider: m.provider,
		free: !m.cost || (m.cost.input === 0 && m.cost.output === 0),
		tools: (m.toolCallStreaming ?? "unknown") as boolean | "unknown",
		costIn: m.cost?.input ?? 0,
		costOut: m.cost?.output ?? 0,
		contextWindow: m.contextWindow ?? 0,
	}));
	return models.filter((m) => m.tools !== false && m.contextWindow >= 32_000).sort((a, b) => Number(b.free) - Number(a.free) || Number(b.tools === true) - Number(a.tools === true) || a.costOut - b.costOut);
}
