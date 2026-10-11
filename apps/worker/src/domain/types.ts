// Hive's domain model. Goal → Change → Evidence → Evaluation → Decision → Integration.
// Evidence is deterministic (tests, builds); Evaluations are model opinions and are always labeled as such.

export type GoalStatus = "open" | "planning" | "planned" | "in_progress" | "racing" | "achieved" | "abandoned";
export type ChangeStatus =
	| "drafting" // agent is working in its fork
	| "submitted" // pushed and waiting in the convergence queue
	| "converging" // landing workflow is running
	| "evaluated" // race candidate: evidence + review recorded, waiting for the judge
	| "landed"
	| "bounced" // returned to the agent with conflict/evidence context
	| "escalated" // waiting for a human decision
	| "archived"; // race loser or abandoned

export interface Goal {
	id: string;
	repo: string;
	title: string;
	description: string;
	status: GoalStatus;
	parentId: string | null;
	createdAt: number;
}

export interface SymbolRef {
	path: string;
	name: string; // e.g. "parsePrice" or "Cart.total"
}

export interface Intent {
	id: string;
	changeId: string;
	agentId: string;
	summary: string;
	paths: string[];
	symbols: SymbolRef[];
	createdAt: number;
	releasedAt: number | null;
}

export type OverlapLevel = "textual" | "structural" | "referential";

export interface Overlap {
	level: OverlapLevel;
	otherIntentId: string;
	otherAgentId: string;
	otherSummary: string;
	// What collides: shared paths, shared symbols, or "mine → theirs" references.
	detail: string[];
}

export interface Change {
	id: string; // stable Hive-Change-Id, survives rebases
	goalId: string;
	repo: string; // trunk repo
	fork: string; // per-change Artifacts repo
	agentId: string;
	model: string;
	status: ChangeStatus;
	genesis: string; // trunk commit the fork started from
	head: string | null; // latest pushed commit on the fork
	race: { group: string; index: number; won?: boolean } | null;
	attempts: number;
	createdAt: number;
	updatedAt: number;
}

export interface Evidence {
	id: string;
	changeId: string;
	kind: "setup" | "typecheck" | "lint" | "build" | "test" | "check" | "security" | "merge" | "preview";
	command: string;
	ok: boolean;
	output: string; // truncated
	commit: string;
	createdAt: number;
}

export interface Evaluation {
	id: string;
	changeId: string;
	model: string; // always recorded: this is an opinion, not a fact
	score: number; // 0..1
	summary: string;
	concerns: string[];
	createdAt: number;
}

export type DecisionOutcome = "land" | "bounce" | "escalate" | "win" | "lose";

export interface Decision {
	id: string;
	changeId: string;
	outcome: DecisionOutcome;
	confidence: number; // probability from Clef for the chosen outcome
	probabilities: Record<string, number>;
	rationale: string;
	decidedBy: string; // "clef-flash" or "human:<name>"
	createdAt: number;
}

export interface Agent {
	id: string;
	kind: "builtin" | "mcp" | "cli";
	model: string;
	trust: number; // 0..1, caps auto-land confidence
}

// Messages broadcast to dashboard / agents over WebSocket.
export type HiveEvent =
	| { type: "goal"; goal: Goal }
	| { type: "change"; change: Change }
	| { type: "intent"; intent: Intent; overlaps: Overlap[] }
	| { type: "intent_released"; intentId: string }
	| { type: "evidence"; evidence: Evidence }
	| { type: "evaluation"; evaluation: Evaluation }
	| { type: "decision"; decision: Decision }
	| { type: "trunk"; commit: string; changeId: string | null }
	| { type: "message"; from: string; to: string; text: string }
	| { type: "log"; agentId: string; text: string };
