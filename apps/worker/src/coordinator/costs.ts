// Spend and budgets. Every model call and container run is recorded against its change and goal;
// a goal's spend includes its sub-goals', so a planned goal's budget covers the whole plan.

export interface UsageRow {
	model: string;
	purpose: string;
	changeId: string | null;
	goalId: string | null;
	inputTokens: number;
	outputTokens: number;
	seconds: number;
	cost: number;
}

export interface GoalNode {
	id: string;
	parentId: string | null;
	budget: number | null;
}

// Spend per goal including everything under it.
export function treeSpend(goals: GoalNode[], spendByGoal: Map<string, number>): Map<string, number> {
	const children = new Map<string, string[]>();
	for (const g of goals) if (g.parentId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
	const memo = new Map<string, number>();
	const total = (id: string, seen = new Set<string>()): number => {
		if (memo.has(id)) return memo.get(id)!;
		if (seen.has(id)) return 0;
		seen.add(id);
		const sum = (spendByGoal.get(id) ?? 0) + (children.get(id) ?? []).reduce((n, c) => n + total(c, seen), 0);
		memo.set(id, sum);
		return sum;
	};
	for (const g of goals) total(g.id);
	return memo;
}

// The first budget a goal's work runs into, walking up from the goal to its root. A goal's own
// budget limits it; the root goal falls back to the repository's default budget.
export function budgetExceeded(
	goalId: string,
	goals: GoalNode[],
	spend: Map<string, number>,
	defaultBudget: number | null,
): { goalId: string; limit: number; spent: number } | null {
	const byId = new Map(goals.map((g) => [g.id, g]));
	let node = byId.get(goalId);
	const seen = new Set<string>();
	while (node && !seen.has(node.id)) {
		seen.add(node.id);
		const limit = node.budget ?? (node.parentId === null ? defaultBudget : null);
		const spent = spend.get(node.id) ?? 0;
		if (limit !== null && spent >= limit) return { goalId: node.id, limit, spent };
		node = node.parentId ? byId.get(node.parentId) : undefined;
	}
	return null;
}
