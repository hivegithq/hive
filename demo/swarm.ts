// Put six agents to work on the seeded shop at once. The goals are chosen so that Hive's
// three overlap levels all show up:
//   structural:  two goals both need to change checkout()
//   referential: one goal changes parsePrice's contract while another edits code that calls it
//   textual:     two goals touch different functions in price.ts
// and two goals are fully independent, so the queue lands them first.
//
//   node demo/swarm.ts [repo] [hive-url]

const repo = process.argv[2] ?? "shop";
const hive = process.argv[3] ?? process.env.HIVE_URL ?? "http://localhost:5173";

const GOALS = [
	{
		title: "Free shipping on orders over $50",
		description: "In checkout(), shipping should be 0 when the discounted subtotal is at least 5000 cents. Add a test.",
	},
	{
		title: "Percentage discount codes",
		description:
			"Support discounts that take a percentage off (e.g. SAVE10 = 10%). Extend Discount with an optional percentOff, apply it in applyDiscount and make sure checkout() uses it. Add tests.",
	},
	{
		title: "Cart quantities",
		description: "Cart.add should accept an optional quantity (default 1). Add Cart.setQuantity(sku, qty) that removes the line at 0. Add tests.",
	},
	{
		title: "Format prices with thousands separators",
		description: "formatPrice(123456789) should return \"$1,234,567.89\". Keep negative amounts working. Add tests.",
	},
	{
		title: "Accept euro-style decimals in parsePrice",
		description: "parsePrice(\"12,50 €\") should return 1250. Existing inputs like \"$1,000\" must keep working. Add tests.",
	},
	{
		title: "Document the public API",
		description: "Add a README.md describing each exported function and class with a short example. Do not change code.",
	},
];

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${hive}${path}`, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

// Spread agents across models: each model has its own per-minute rate limit, and a mixed swarm
// shows Hive doesn't care who (or what) wrote a change. Free plan: use gpt-oss-120b, qwen3.8-27b, nemotron.
const MODELS = (process.env.HIVE_MODELS ?? "@cf/moonshotai/kimi-k2.7-code,@cf/zai-org/glm-5.3,@cf/deepseek-ai/deepseek-v4-pro-0813").split(",");

const started = await Promise.all(
	GOALS.map(async (g, i) => {
		const goal = await call<{ id: string }>("POST", `/api/repos/${repo}/goals`, g);
		const model = MODELS[i % MODELS.length];
		const change = await call<{ id: string; agentId: string }>("POST", `/api/repos/${repo}/goals/${goal.id}/assign`, { model });
		return { goal: g.title, change: change.id, model: model.split("/").at(-1) };
	}),
);
console.table(started);
console.log(`Watch them converge at ${hive}/r/${repo}`);
