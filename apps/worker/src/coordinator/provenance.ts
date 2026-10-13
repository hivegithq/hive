// The history of a repository, grouped by goal: its attempts, what happened to each (submitted, sent
// back, waiting for a person, landed), and the pull request it became.

export interface PGoal {
	id: string;
	title: string;
	status: string;
	parentId: string | null;
	createdAt: number;
}
export interface PChange {
	id: string;
	goalId: string;
	model: string;
	status: string;
	createdAt: number;
	submittedAt: number | null;
}
export interface PDecision {
	changeId: string;
	outcome: string;
	decidedBy: string;
	rationale: string;
	createdAt: number;
}

export interface Step {
	at: number;
	kind: "started" | "submitted" | "land" | "bounce" | "escalate" | "win" | "lose";
	by?: string;
	text?: string;
}
export interface Attempt {
	changeId: string;
	model: string;
	status: string;
	steps: Step[];
}
export interface GoalHistory {
	goal: PGoal;
	subgoals: PGoal[];
	attempts: Attempt[];
	pr: { url: string; number: number } | null;
	cost: number;
	at: number; // when anything last happened to it
}

export function provenance(input: {
	goals: PGoal[];
	changes: PChange[];
	decisions: PDecision[];
	prs: Record<string, { url: string; number: number }>;
	costByGoal: Record<string, number>;
	limit?: number;
}): GoalHistory[] {
	const byChange = new Map<string, PDecision[]>();
	for (const d of input.decisions) byChange.set(d.changeId, [...(byChange.get(d.changeId) ?? []), d]);
	const roots = input.goals.filter((g) => !g.parentId || !input.goals.some((p) => p.id === g.parentId));
	const history = roots.map((goal) => {
		const family = new Set([goal.id, ...input.goals.filter((g) => g.parentId === goal.id).map((g) => g.id)]);
		const attempts: Attempt[] = input.changes
			.filter((c) => family.has(c.goalId))
			.sort((a, b) => a.createdAt - b.createdAt)
			.map((c) => {
				const steps: Step[] = [{ at: c.createdAt, kind: "started" }];
				if (c.submittedAt) steps.push({ at: c.submittedAt, kind: "submitted" });
				for (const d of (byChange.get(c.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)) {
					steps.push({ at: d.createdAt, kind: d.outcome as Step["kind"], by: d.decidedBy, text: d.rationale.split("\n")[0].slice(0, 200) });
				}
				return { changeId: c.id, model: c.model, status: c.status, steps: steps.sort((a, b) => a.at - b.at) };
			});
		const cost = [...family].reduce((n, id) => n + (input.costByGoal[id] ?? 0), 0);
		const last = Math.max(goal.createdAt, ...attempts.flatMap((a) => a.steps.map((s) => s.at)));
		return { goal, subgoals: input.goals.filter((g) => g.parentId === goal.id), attempts, pr: input.prs[goal.id] ?? null, cost, at: last };
	});
	return history.sort((a, b) => b.at - a.at).slice(0, input.limit ?? 40);
}
