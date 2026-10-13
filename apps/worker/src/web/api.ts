import { useCallback, useEffect, useRef, useState } from "react";
import type { Change, Decision, Evaluation, Evidence, Goal, HiveEvent, Intent, Overlap } from "../domain/types.ts";
import type { EvidencePlan } from "../evidence/plan.ts";
import type { EvidenceRun } from "../landing/types.ts";
import { ACCESS, sessionToken } from "./clerk.ts";
import { askForAccess, TOKEN_KEY } from "./ui/AccessDialog.tsx";

export interface Snapshot {
	repo: string;
	counts?: Record<string, number>;
	goals: Goal[];
	changes: Change[];
	intents: Intent[];
	queue: { changeId: string; position: number }[];
	decisions: Decision[];
	agents: { id: string; kind: string; model: string; trust: number }[];
	goalDeps?: [string, string][];
	goalIssues?: Record<string, { ref: string; url: string }>;
	goalPrs?: Record<string, { number: number; url: string; state: string }>;
	trunkChecks?: { commit: string; at: number; ok: boolean; languages: string[]; source: string; runs: { kind: string; command: string; ok: boolean }[] } | null;
}

export interface RepoSettings {
	decider: "clef" | "evidence";
	batchMax: number;
	security: boolean;
	goalBudget: number | null;
	reviewModel: string | null;
	autoFix: boolean;
}

export interface Costs {
	total: number;
	byModel: { model: string; cost: number; inputTokens: number; outputTokens: number; seconds: number; calls: number }[];
	byPurpose: Record<string, number>;
	byGoal: Record<string, { cost: number; budget: number | null }>;
	byChange: Record<string, number>;
	goalBudget: number | null;
}

export interface ReviewComment {
	id: string;
	changeId: string;
	path: string | null;
	line: number | null;
	side: "new" | "old";
	excerpt: string | null;
	body: string;
	author: string;
	createdAt: number;
	sentAt: number | null;
}

export type Why =
	| { path: string; line: number; found: false }
	| {
			path: string;
			line: number;
			found: true;
			text: string;
			commit: string;
			author: string;
			at: number;
			subject: string;
			hive: {
				changeId: string;
				goal: { id: string; title: string; description: string } | null;
				issue: { ref: string; url: string } | null;
				model: string;
				agent: string;
				intent: { summary: string; symbols: string[] } | null;
				evidence: { kind: string; command: string; ok: boolean }[];
				review: string | null;
				decision: { outcome: string; rationale: string; decidedBy: string; confidence: number } | null;
				comments: string[];
				transcript: string | null;
			} | null;
	  };

export interface ContextBreakdown {
	steps: { step: number; tokens: Record<"system" | "briefing" | "reasoning" | "calls" | "results", number>; total: number }[];
	biggest: { step: number; tool: string; tokens: number }[];
	windowEstimate: number;
}

export interface GoalHistory {
	goal: { id: string; title: string; status: string; parentId: string | null; createdAt: number };
	subgoals: { id: string; title: string; status: string }[];
	attempts: { changeId: string; model: string; status: string; steps: { at: number; kind: string; by?: string; text?: string }[] }[];
	pr: { url: string; number: number } | null;
	cost: number;
	at: number;
}

export interface ModelStats {
	model: string;
	started: number;
	landed: number;
	landingRate: number;
	bounces: number;
	escalations: number;
	medianMinutesToLand: number | null;
	cost: number;
	costPerLanded: number | null;
}

export type GitHubStatus =
	| { connected: false; pullRequests: GitHubPr[] }
	| {
			connected: true;
			owner: string;
			repo: string;
			repoUrl: string;
			base: string;
			branch: string;
			mirror: boolean;
			prs: boolean;
			pullRequests: GitHubPr[];
			pull: boolean;
			lastMirror: { at: number; head: string } | null;
			lastPull: { at: number; count: number } | null;
			lastRun: number | null;
			error: string | null;
	  };
export interface Recurring {
	id: string;
	title: string;
	description: string;
	every: string;
	everyMinutes: number;
	mode: "one" | "plan" | "race";
	models: string[];
	budget: number | null;
	enabled: boolean;
	nextRun: number;
	lastGoal: string | null;
	lastGoalStatus: string | null;
	runs: number;
}

export interface Lesson {
	id: string;
	text: string;
	source: string;
	changeId: string | null;
	active: boolean;
	createdAt: number;
}

export interface Hook {
	id: string;
	url: string;
	format: "json" | "slack" | "discord";
	events: string[];
	createdAt: number;
	last: { at: number; ok: boolean; status: number | null; error: string | null } | null;
}

export interface GitHubPr {
	goalId: string;
	state: string;
	number: number | null;
	url: string | null;
	reason: string | null;
}

export interface ChangeCost {
	total: number;
	parts: { model: string; purpose: string; cost: number; inputTokens: number; outputTokens: number; seconds: number }[];
}

export type { EvidencePlan } from "../evidence/plan.ts";
export type { EvidenceRun } from "../landing/types.ts";

export interface TrunkCommit {
	hash: string;
	message: string;
	author: { name: string; email: string };
	committedAt: number;
	trailers: Record<string, string>;
}

export interface ChangeDetail {
	change: Change;
	goal: Goal | null;
	intent: Intent | null;
	evidence: Evidence[];
	evaluations: Evaluation[];
	decisions: Decision[];
	cost?: ChangeCost;
	comments?: ReviewComment[];
	messages?: { from: string; to: string; text: string; at: number }[];
	issue?: { ref: string; url: string } | null;
}

export interface LogLine {
	at: number;
	agentId: string;
	text: string;
}

// Tool-calling models on Workers AI. `paid` ones need the Workers Paid plan.
export const MODELS = [
	{ id: "@cf/moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code", paid: true },
	{ id: "@cf/zai-org/glm-5.3", label: "GLM 5.3", paid: true },
	{ id: "@cf/deepseek-ai/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", paid: true },
	{ id: "@cf/openai/gpt-oss-120b", label: "gpt-oss 120B", paid: false },
	{ id: "@cf/qwen/qwen3.8-27b", label: "Qwen 3.8 27B", paid: false },
	{ id: "@cf/nvidia/nemotron-3-120b-a12b", label: "Nemotron 3 120B", paid: false },
];

// CamelAI's catalog, when this deployment has a key: free and tool-capable models first. Loaded once.
export interface PickerModel {
	id: string;
	label: string;
	paid: boolean;
	camel?: boolean;
}
let camelLoaded: Promise<PickerModel[]> | null = null;
const loadCamel = () =>
	(camelLoaded ??= fetch("/api/camel/models")
		.then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string; provider: string; free: boolean; costOut: number }[]>) : []))
		.then((ms) => ms.map((m) => ({ id: m.id, label: `${m.name}${m.free ? " (free)" : ""} · ${m.provider}`, paid: !m.free, camel: true })))
		.catch(() => []));

// The models to offer: Workers AI's, then CamelAI's. `all`: every CamelAI model (for a single choice);
// otherwise the first few, which are the free ones (for lists of checkboxes).
export function useModels(all = false): PickerModel[] {
	const [camel, setCamel] = useState<PickerModel[]>([]);
	useEffect(() => {
		let live = true;
		loadCamel().then((m) => live && setCamel(m));
		return () => {
			live = false;
		};
	}, []);
	return [...MODELS, ...(all ? camel : camel.slice(0, 8))];
}

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? (id.startsWith("camel/") ? `${(id.split("/").at(-1) ?? id).replace(/:free$/, "")} (CamelAI)` : (id.split("/").at(-1) ?? id));

const readToken = () => {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
};

// Signed-in visitors send their Clerk session token; on a Hive without sign-in, the owner's token.
const credential = async () => (ACCESS === "clerk" ? await sessionToken() : readToken());

async function call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
	const headers: Record<string, string> = {};
	if (body) headers["content-type"] = "application/json";
	if (method !== "GET") {
		const token = await credential();
		if (token) headers.authorization = `Bearer ${token}`;
	}
	const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
	if (res.status === 401 && !retried && (await askForAccess()) === "retry") return call<T>(method, path, body, true);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error((data as { error?: string }).error ?? `${method} ${path} failed with ${res.status}`);
	return data as T;
}

export const api = {
	openRepo: (name: string) => call<{ name: string }>("POST", "/api/repos", { name }),
	importRepo: (input: { url: string; name?: string; branch?: string; token?: string }) =>
		call<{ name: string; head: string; commits: number; files: number }>("POST", "/api/repos/import", input),
	snapshot: (repo: string) => call<Snapshot>("GET", `/api/repos/${repo}`),
	trunk: (repo: string) => call<TrunkCommit[]>("GET", `/api/repos/${repo}/trunk?limit=40`),
	change: (repo: string, id: string) => call<ChangeDetail>("GET", `/api/repos/${repo}/changes/${id}`),
	addComment: (repo: string, id: string, c: { path?: string | null; line?: number | null; side?: "new" | "old"; excerpt?: string | null; body: string }) =>
		call<ReviewComment[]>("POST", `/api/repos/${repo}/changes/${id}/comments`, c),
	deleteComment: (repo: string, id: string, commentId: string) => call<ReviewComment[]>("POST", `/api/repos/${repo}/changes/${id}/comments/${commentId}/delete`, {}),
	context: (repo: string, id: string) => call<ContextBreakdown>("GET", `/api/repos/${repo}/changes/${id}/context`),
	steps: (repo: string, id: string) => call<{ step: number; calls: string[]; said: string; edits: number }[]>("GET", `/api/repos/${repo}/changes/${id}/steps`),
	fix: (repo: string, id: string, model?: string) => call<Change>("POST", `/api/repos/${repo}/changes/${id}/fix`, { model }),
	rewind: (repo: string, id: string, step: number, opts: { model?: string; guidance?: string; replace?: boolean }) => call<Change>("POST", `/api/repos/${repo}/changes/${id}/rewind`, { step, ...opts }),
	tryAgain: (repo: string, id: string, opts: { model?: string; guidance?: string; replace?: boolean }) =>
		call<Change>("POST", `/api/repos/${repo}/changes/${id}/retry`, opts),
	why: (repo: string, path: string, line: number) => call<Why>("GET", `/api/repos/${repo}/why?path=${encodeURIComponent(path)}&line=${line}`),
	steer: (repo: string, id: string, text: string) => call<{ from: string; to: string; text: string; at: number }[]>("POST", `/api/repos/${repo}/changes/${id}/steer`, { text }),
	sendComments: (repo: string, id: string) => call<{ sent: number }>("POST", `/api/repos/${repo}/changes/${id}/comments/send`, {}),
	diff: (repo: string, id: string) =>
		call<{ source: string; base: string; head: string; diff: string; truncated: boolean; createdAt: number }>("GET", `/api/repos/${repo}/changes/${id}/diff`),
	createGoal: (repo: string, title: string, description: string, budget?: number) =>
		call<Goal>("POST", `/api/repos/${repo}/goals`, { title, description, ...(budget ? { budget } : {}) }),
	setGoalBudget: (repo: string, goalId: string, budget: number | null) => call("POST", `/api/repos/${repo}/goals/${goalId}/budget`, { budget }),
	costs: (repo: string) => call<Costs>("GET", `/api/repos/${repo}/costs`),
	history: (repo: string) => call<GoalHistory[]>("GET", `/api/repos/${repo}/history`),
	models: (repo: string) => call<ModelStats[]>("GET", `/api/repos/${repo}/models`),
	github: (repo: string) => call<GitHubStatus>("GET", `/api/repos/${repo}/github`),
	lessons: (repo: string) => call<Lesson[]>("GET", `/api/repos/${repo}/lessons`),
	addLesson: (repo: string, text: string) => call<Lesson[]>("POST", `/api/repos/${repo}/lessons`, { text }),
	setLesson: (repo: string, id: string, patch: { active?: boolean; remove?: boolean }) => call<Lesson[]>("POST", `/api/repos/${repo}/lessons/${id}`, patch),
	recurring: (repo: string) => call<Recurring[]>("GET", `/api/repos/${repo}/recurring`),
	addRecurring: (repo: string, input: { title: string; description?: string; every: string; mode?: string; models?: string[]; budget?: number }) =>
		call<Recurring>("POST", `/api/repos/${repo}/recurring`, input),
	runRecurring: (repo: string, id: string) => call<{ skipped: boolean; reason?: string; goalId?: string }>("POST", `/api/repos/${repo}/recurring/${id}/run`, {}),
	setRecurring: (repo: string, id: string, patch: { enabled?: boolean; remove?: boolean }) => call<Recurring[]>("POST", `/api/repos/${repo}/recurring/${id}`, patch),
	hooks: (repo: string) => call<Hook[]>("GET", `/api/repos/${repo}/notifications`),
	addHook: (repo: string, input: { url: string; events?: string[] }) => call<Hook & { signingSecret: string | null }>("POST", `/api/repos/${repo}/notifications`, input),
	testHook: (repo: string, id: string) => call<Hook["last"]>("POST", `/api/repos/${repo}/notifications/${id}/test`, {}),
	removeHook: (repo: string, id: string) => call<Hook[]>("POST", `/api/repos/${repo}/notifications/${id}/remove`, {}),
	connectGitHub: (repo: string, input: { token: string; remote?: string; mirror: boolean; prs: boolean; pull: boolean }) =>
		call<GitHubStatus>("POST", `/api/repos/${repo}/github`, input),
	githubOptions: (repo: string, patch: { mirror?: boolean; prs?: boolean; pull?: boolean }) => call<GitHubStatus>("POST", `/api/repos/${repo}/github/options`, patch),
	githubSync: (repo: string) => call<GitHubStatus>("POST", `/api/repos/${repo}/github/sync`, {}),
	githubDisconnect: (repo: string) => call<GitHubStatus>("POST", `/api/repos/${repo}/github/disconnect`, {}),
	importIssues: (repo: string, input: { source?: string; labels?: string[]; excludeLabels?: string[]; limit?: number; token?: string }) =>
		call<{ source: string; open: number; alreadyImported: number; created: { goalId: string; ref: string; title: string; url: string }[] }>(
			"POST",
			`/api/repos/${repo}/issues/import`,
			input,
		),
	assign: (repo: string, goalId: string, model: string) => call<Change>("POST", `/api/repos/${repo}/goals/${goalId}/assign`, { model }),
	settings: (repo: string) => call<RepoSettings>("GET", `/api/repos/${repo}/settings`),
	setSettings: (repo: string, patch: Partial<RepoSettings>) => call<RepoSettings>("POST", `/api/repos/${repo}/settings`, patch),
	checkPlan: (repo: string) => call<EvidencePlan>("GET", `/api/repos/${repo}/checks/plan`),
	runChecks: (repo: string) => call<{ commit: string; plan: EvidencePlan; runs: EvidenceRun[]; ms: number }>("POST", `/api/repos/${repo}/checks`),
	plan: (repo: string, goalId: string, opts: { model?: string; agentModel?: string; agentModels?: string[]; maxParallel?: number }) =>
		call<{ plannerId: string }>("POST", `/api/repos/${repo}/goals/${goalId}/plan`, opts),
	race: (repo: string, goalId: string, models: string[]) => call("POST", `/api/repos/${repo}/goals/${goalId}/race`, { models }),
	decide: (repo: string, changeId: string, outcome: "land" | "bounce", note?: string) =>
		call("POST", `/api/repos/${repo}/changes/${changeId}/decision`, { outcome, by: "dashboard", note }),
	pickWinner: (repo: string, group: string, changeId: string) => call("POST", `/api/repos/${repo}/races/${group}/winner`, { changeId, by: "dashboard" }),
	clone: (repo: string) => call<{ command: string }>("POST", `/api/repos/${repo}/clone`, { scope: "read" }),
};

// Live view of one repo: a snapshot from the coordinator, kept current by its WebSocket.
export function useHive(repo: string) {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [trunk, setTrunk] = useState<TrunkCommit[]>([]);
	const [overlaps, setOverlaps] = useState<Record<string, Overlap[]>>({}); // by changeId
	const [log, setLog] = useState<LogLine[]>([]);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tick, setTick] = useState(0); // bumps on evidence/evaluation so open details refetch
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refresh = useCallback(() => {
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => {
			api.snapshot(repo).then(setSnapshot, (e) => setError(e.message));
		}, 250);
	}, [repo]);

	const refreshTrunk = useCallback(() => {
		api.trunk(repo).then(setTrunk, () => {});
	}, [repo]);

	useEffect(() => {
		refreshTrunk();
		let ws: WebSocket | null = null;
		let retry: ReturnType<typeof setTimeout>;
		let closed = false;

		const connect = () => {
			const proto = location.protocol === "https:" ? "wss" : "ws";
			ws = new WebSocket(`${proto}://${location.host}/agents/coordinator/${repo}`);
			ws.onopen = () => {
				setConnected(true);
				setError(null);
			};
			ws.onclose = () => {
				setConnected(false);
				if (!closed) retry = setTimeout(connect, 1500);
			};
			ws.onmessage = (msg) => {
				let data: HiveEvent | { type: "snapshot"; snapshot: Snapshot } | { type: "batch"; events: HiveEvent[] } | { type: string };
				try {
					data = JSON.parse(msg.data);
				} catch {
					return;
				}
				if (data.type === "snapshot" && "snapshot" in data) return setSnapshot(data.snapshot);
				const events = data.type === "batch" && "events" in data ? data.events : [data as HiveEvent];
				for (const event of events) handle(event);
			};
			const handle = (event: HiveEvent) => {
				switch (event.type) {
					case "intent":
						setOverlaps((o) => ({ ...o, [event.intent.changeId]: event.overlaps }));
						return refresh();
					case "log":
						return setLog((l) => [...l.slice(-60), { at: Date.now(), agentId: event.agentId, text: event.text }]);
					case "message":
						return setLog((l) => [...l.slice(-60), { at: Date.now(), agentId: event.from, text: `to ${event.to}: ${event.text}` }]);
					case "trunk":
						refreshTrunk();
						return refresh();
					case "evidence":
					case "evaluation":
					case "comment":
						return setTick((t) => t + 1);
					default:
						setTick((t) => t + 1);
						return refresh();
				}
			};
		};
		connect();
		return () => {
			closed = true;
			clearTimeout(retry);
			ws?.close();
		};
	}, [repo, refresh, refreshTrunk]);

	return { snapshot, trunk, overlaps, log, connected, error, tick, refresh };
}
