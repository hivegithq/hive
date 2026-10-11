// Race several models on one goal. Each gets its own fork; Clef judges the finished candidates
// on evidence and review, and only the winner enters the convergence queue.
//
//   node demo/race.ts [repo] [hive-url]

const repo = process.argv[2] ?? "shop";
const hive = process.argv[3] ?? process.env.HIVE_URL ?? "http://localhost:5173";

// Needs Workers Paid. On the free plan use "@cf/openai/gpt-oss-120b", "@cf/qwen/qwen3.8-27b", "@cf/nvidia/nemotron-3-120b-a12b".
const MODELS = ["@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.3", "@cf/deepseek-ai/deepseek-v4-pro-0813"];

async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${hive}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

const goal = await post<{ id: string }>(`/api/repos/${repo}/goals`, {
	title: "Buy-two-get-one-free promotion",
	description:
		"Add a promotion to checkout(): for any SKU with quantity 3 or more, every third unit is free. Show the saving on the Receipt as `promotion` (cents). Add tests covering 2, 3 and 7 units.",
});
const race = await post<{ group: string; changes: { id: string; model: string }[] }>(`/api/repos/${repo}/goals/${goal.id}/race`, { models: MODELS });
console.log(`Race ${race.group}:`);
for (const c of race.changes) console.log(`  ${c.id}  ${c.model}`);
console.log(`Watch it at ${hive}/r/${repo}`);
