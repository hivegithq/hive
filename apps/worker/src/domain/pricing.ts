// What Hive's work costs, from Workers AI's and Containers' published prices (USD, October 2026).
// https://developers.cloudflare.com/workers-ai/platform/pricing/
// https://developers.cloudflare.com/containers/pricing/

// Per million tokens.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
	"@cf/moonshotai/kimi-k2.7-code": { input: 0.95, output: 4.0 },
	"@cf/moonshotai/kimi-k2.6": { input: 0.95, output: 4.0 },
	"@cf/moonshotai/kimi-k2.5": { input: 0.6, output: 3.0 },
	"@cf/deepseek-ai/deepseek-v4-pro-0813": { input: 1.32, output: 3.96 },
	"@cf/zai-org/glm-5.3": { input: 1.4, output: 4.4 },
	"@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75 },
	"@cf/qwen/qwen3.8-27b": { input: 0.45, output: 3.2 },
	"@cf/nvidia/nemotron-3-120b-a12b": { input: 0.5, output: 1.5 },
	"@cf/cloudflare/clef-flash": { input: 0.038, output: 0 },
};

export const modelCost = (model: string, inputTokens: number, outputTokens: number): number => {
	const p = MODEL_PRICES[model];
	return p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : 0;
};

export const isPriced = (model: string) => model in MODEL_PRICES;

// Per second while running: vCPU at $0.000020, memory at $0.0000025 per GiB (disk is negligible).
const INSTANCES: Record<string, { vcpu: number; gib: number }> = {
	lite: { vcpu: 1 / 16, gib: 0.25 },
	basic: { vcpu: 0.25, gib: 1 },
	"standard-1": { vcpu: 0.5, gib: 4 },
	"standard-2": { vcpu: 1, gib: 6 },
	"standard-3": { vcpu: 2, gib: 8 },
	"standard-4": { vcpu: 4, gib: 12 },
};

export const containerCost = (instance: string, seconds: number): number => {
	const i = INSTANCES[instance] ?? INSTANCES["standard-1"];
	return seconds * (i.vcpu * 0.00002 + i.gib * 0.0000025);
};

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
