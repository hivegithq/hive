import { useCallback, useEffect, useRef, useState } from "react";
import type { Change, Decision, Evaluation, Evidence, Goal, HiveEvent, Intent, Overlap } from "../domain/types.ts";
import type { EvidencePlan } from "../evidence/plan.ts";
import type { EvidenceRun } from "../landing/types.ts";
import { getToken } from "@clerk/react";
import { ACCESS } from "./clerk.ts";
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
	trunkChecks?: { commit: string; at: number; ok: boolean; languages: string[]; source: string; runs: { kind: string; command: string; ok: boolean }[] } | null;
}

export interface RepoSettings {
	decider: "clef" | "evidence";
	batchMax: number;
	security: boolean;
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

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id.split("/").at(-1) ?? id;

const readToken = () => {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
};

// Signed-in visitors send their Clerk session token; on a Hive without sign-in, the owner's token.
const credential = async () => (ACCESS === "clerk" ? await getToken().catch(() => null) : readToken());

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
	createGoal: (repo: string, title: string, description: string) => call<Goal>("POST", `/api/repos/${repo}/goals`, { title, description }),
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
