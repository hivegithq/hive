// A planner's proposal: sub-goals keyed by short ids, with dependencies between them.

export interface PlannedGoal {
	key: string;
	title: string;
	description: string;
	paths?: string[];
	dependsOn?: string[];
}

// Keys unique, dependencies known, no cycles.
export function validatePlan(subgoals: PlannedGoal[]): string | null {
	if (subgoals.length === 0) return "a plan needs at least one sub-goal";
	if (subgoals.length > 40) return "at most 40 sub-goals; group smaller steps together";
	const keys = new Set<string>();
	for (const s of subgoals) {
		if (keys.has(s.key)) return `duplicate key ${s.key}`;
		keys.add(s.key);
	}
	for (const s of subgoals) for (const d of s.dependsOn ?? []) if (!keys.has(d)) return `${s.key} depends on unknown ${d}`;
	const state = new Map<string, 1 | 2>();
	const deps = new Map(subgoals.map((s) => [s.key, s.dependsOn ?? []]));
	const visit = (k: string): boolean => {
		if (state.get(k) === 2) return false;
		if (state.get(k) === 1) return true;
		state.set(k, 1);
		for (const d of deps.get(k) ?? []) if (visit(d)) return true;
		state.set(k, 2);
		return false;
	};
	for (const s of subgoals) if (visit(s.key)) return `dependency cycle through ${s.key}`;
	return null;
}

// How a plan's agents are set up. Older plans stored a single agentModel.
export interface PlanSettings {
	model: string;
	agentModels: string[];
	maxParallel: number;
}

export function readPlanSettings(raw: string, fallbackModel: string): PlanSettings {
	const s = JSON.parse(raw) as Partial<PlanSettings> & { agentModel?: string };
	const agentModels = s.agentModels?.length ? s.agentModels : [s.agentModel ?? fallbackModel];
	return { model: s.model ?? "", agentModels, maxParallel: s.maxParallel ?? 6 };
}

// Sub-goals take the plan's agent models in turn (by their order in the plan), so a plan with
// several models spreads its work across all of them.
export const modelForSubgoal = (agentModels: string[], index: number) => agentModels[index % agentModels.length];
