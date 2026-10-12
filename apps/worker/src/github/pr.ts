// The pull request Hive opens for a goal it landed: what changed, the proof, and who decided.

export interface PrGoal {
	id: string;
	title: string;
	description: string;
	issue: { ref: string; url: string } | null;
	subgoals: { title: string }[];
	changes: {
		id: string;
		model: string;
		evidence: { command: string; ok: boolean }[];
		decision: { rationale: string; decidedBy: string; confidence: number } | null;
		cost: number;
	}[];
	dashboard: string; // link to the repository's live dashboard
}

export function prTitle(goal: PrGoal): string {
	return goal.title.replace(/\s*\(#\d+\)$/, "").slice(0, 200);
}

export function prBody(goal: PrGoal, sameRepoIssue: boolean): string {
	const lines: string[] = [];
	if (goal.issue) lines.push(sameRepoIssue ? `Fixes ${goal.issue.ref.replace(/^.*#/, "#")}` : `For ${goal.issue.url}`, "");
	const description = goal.issue ? "" : goal.description.trim();
	if (description) lines.push(description.slice(0, 2000), "");
	if (goal.subgoals.length) {
		lines.push(`Planned as ${goal.subgoals.length} sub-goals:`, ...goal.subgoals.map((s) => `- ${s.title}`), "");
	}
	lines.push("### How it landed in Hive", "");
	for (const c of goal.changes) {
		const passed = c.evidence.filter((e) => e.ok).map((e) => `\`${e.command}\``);
		lines.push(`**${c.id}** by ${c.model}${c.cost > 0 ? ` (≈$${c.cost.toFixed(2)})` : ""}`);
		if (passed.length) lines.push(`- Checks passed: ${passed.join(", ")}`);
		if (c.decision) lines.push(`- Landed by ${c.decision.decidedBy} (${Math.round(c.decision.confidence * 100)}%): ${c.decision.rationale}`);
		lines.push("");
	}
	lines.push(`Evidence, reviews and transcripts: ${goal.dashboard}`, "", "_Opened by [Hive](https://hivegit.dev): version control for many agents at once._");
	return lines.join("\n");
}
