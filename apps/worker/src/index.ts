import { Hono } from "hono";
import { z } from "zod";
import { agentOf, coordinatorOf, simOf } from "./bindings.ts";
import { handleMcp } from "./mcp/server.ts";
import { authenticatedRemote, parseTrailers, repoHost } from "./repo/index.ts";
import { actor } from "./auth.ts";

export { CodingAgent } from "./agent/CodingAgent.ts";
export { RepoCoordinator } from "./coordinator/RepoCoordinator.ts";
export { LandingWorkflow } from "./landing/LandingWorkflow.ts";
export { ModelGate } from "./agent/ModelGate.ts";
export { SimAgent } from "./agent/SimAgent.ts";
export { PlannerAgent } from "./agent/PlannerAgent.ts";
export { MergeBox } from "./landing/MergeBox.ts";
export { Outbound } from "./sandbox/outbound.ts";

const app = new Hono<{ Bindings: Env }>();
const coordinator = coordinatorOf;

const body = async <T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> => schema.parse(await req.json());

// Over MCP, anyone may connect, list tools and use the read-only ones (as with GET over REST).
// A tool that changes things needs the token; without it the call gets a JSON-RPC error that
// says how to get write access. Not an HTTP 401: MCP clients take that as "start an OAuth login".
const MCP_READ_TOOLS = new Set(["hive_status", "hive_symbols", "hive_change"]);
async function refuseMcpWrite(request: Request): Promise<Response | null> {
	if (request.method !== "POST") return null;
	let body: unknown;
	try {
		body = await request.clone().json();
	} catch {
		return null;
	}
	const messages = (Array.isArray(body) ? body : [body]) as { id?: unknown; method?: string; params?: { name?: string } }[];
	const writes = messages.filter((m) => m?.method === "tools/call" && !MCP_READ_TOOLS.has(String(m.params?.name)));
	if (writes.length === 0) return null;
	const message =
		"This Hive is read-only without its access token. Pass it with --header \"Authorization: Bearer <token>\" when adding the server, or run your own Hive: https://hivegit.dev/docs/deploy";
	const replies = writes.map((m) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code: -32001, message } }));
	return Response.json(Array.isArray(body) ? replies : replies[0]);
}

// Writes spend money (agents, containers, model calls) and change trunk, so they need the owner's
// HIVE_TOKEN or a signed-in user (auth.ts). Reads stay public: the dashboard, trunk and ledger are
// meant to be seen.
const authorized = async (req: Request, env: Env) => (await actor(req, env as Env & { HIVE_TOKEN?: string })) !== null;

app.use("/api/*", async (c, next) => {
	if (c.req.method === "GET" || (await authorized(c.req.raw, c.env))) return next();
	return c.json({ error: "Making changes here needs you to be signed in with access, or this deployment's HIVE_TOKEN." }, 401);
});

app.onError((err, c) => {
	if (err instanceof z.ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
	console.error(err);
	return c.json({ error: err.message }, 500);
});

// ── Repos ──────────────────────────────────────────────────────────────────

app.post("/api/repos", async (c) => {
	const { name } = await body(c.req.raw, z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$/) }));
	const remotes = await coordinator(c.executionCtx.exports, name).init();
	return c.json({ name, ...remotes }, 201);
});

// Import an existing repository (GitHub or any https git server) into a new Hive repo. `token` is
// only for private repositories; it's used for this one clone and never stored.
app.post("/api/repos/import", async (c) => {
	const input = await body(
		c.req.raw,
		z.object({
			url: z.string().url(),
			name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$/).optional(),
			branch: z.string().max(200).optional(),
			token: z.string().max(500).optional(),
		}),
	);
	const name = input.name ?? repoNameFromUrl(input.url);
	const result = await coordinator(c.executionCtx.exports, name).importFrom({ url: input.url, branch: input.branch, token: input.token });
	return c.json({ name, ...result }, 201);
});

// Hive-wide numbers for the landing page: the showcase repositories summed, cached for a minute.
const SHOWCASE = ["scale2k", "final1k", "clean1k", "swarm1k", "load1k", "load", "vulnshop", "itoa", "sampleproject", "uuid", "store", "shop"];
app.get("/api/hive/stats", async (c) => {
	const cache = caches.default;
	const key = new Request(new URL("/api/hive/stats", c.req.url).toString());
	const hit = await cache.match(key);
	if (hit) return hit;
	const repos = await Promise.all(SHOWCASE.map((r) => coordinator(c.executionCtx.exports, r).summary()));
	const total = (k: "changes" | "landed" | "aiChanges" | "aiLanded" | "goals" | "plans" | "batches") => repos.reduce((n, r) => n + r[k], 0);
	const body = {
		repos: repos.filter((r) => r.changes > 0 || r.checks),
		totals: {
			repos: repos.filter((r) => r.changes > 0 || r.checks).length,
			changes: total("changes"),
			landed: total("landed"),
			aiChanges: total("aiChanges"),
			aiLanded: total("aiLanded"),
			goals: total("goals"),
			plans: total("plans"),
			batches: total("batches"),
			models: [...new Set(repos.flatMap((r) => r.models))],
			languages: [...new Set(repos.flatMap((r) => r.checks?.languages ?? []))],
		},
		at: Date.now(),
	};
	const res = c.json(body, 200, { "cache-control": "public, max-age=60" });
	c.executionCtx.waitUntil(cache.put(key, res.clone()));
	return res;
});

app.get("/api/repos/:repo/settings", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).settings()));
app.get("/api/repos/:repo/checks/plan", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).checkPlan()));

// Run the repository's checks (hive.json, or detected) on trunk: can Hive build and test it?
app.post("/api/repos/:repo/checks", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).checkTrunk()));

// "https://github.com/acme/Web-App.git" → "web-app"
function repoNameFromUrl(url: string) {
	const base = new URL(url).pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/, "") ?? "repo";
	const name = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	return name.length >= 2 ? name : `repo-${name}`;
}

app.get("/api/repos/:repo", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).snapshot()));

// A short-lived clone command so humans (or any git client) can work with a Hive repo directly.
app.post("/api/repos/:repo/clone", async (c) => {
	const { scope, target } = await body(c.req.raw, z.object({ scope: z.enum(["read", "write"]).default("read"), target: z.string().optional() }));
	const name = target ?? c.req.param("repo");
	const host = repoHost(c.env);
	const repo = await host.get(name);
	if (!repo) return c.json({ error: "not found" }, 404);
	const token = await host.token(name, scope, 3600);
	return c.json({ command: `git clone ${authenticatedRemote(repo.remote, token)} ${name}`, expiresIn: 3600 });
});

app.get("/api/repos/:repo/trunk", async (c) => {
	const commits = await repoHost(c.env).log(c.req.param("repo"), { limit: Number(c.req.query("limit") ?? 50) });
	return c.json(commits.map((commit) => ({ ...commit, trailers: parseTrailers(commit.message) })));
});

app.get("/api/repos/:repo/index", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).indexStatus()));

app.get("/api/repos/:repo/files", async (c) => c.json(await repoHost(c.env).listFiles(c.req.param("repo"), c.req.query("ref") ?? "main")));

// ── Goals, agents, races ───────────────────────────────────────────────────

app.post("/api/repos/:repo/goals", async (c) => {
	const input = await body(
		c.req.raw,
		z.object({ title: z.string().min(3), description: z.string().default(""), parentId: z.string().optional(), budget: z.number().positive().max(10_000).optional() }),
	);
	const coord = coordinator(c.executionCtx.exports, c.req.param("repo"));
	const goal = await coord.createGoal(input);
	if (input.budget) await coord.setGoalBudget(goal.id, input.budget);
	return c.json(goal, 201);
});

// A goal's spending limit in USD, covering its sub-goals; null removes it.
app.post("/api/repos/:repo/goals/:goalId/budget", async (c) => {
	const { budget } = await body(c.req.raw, z.object({ budget: z.number().positive().max(10_000).nullable() }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).setGoalBudget(c.req.param("goalId"), budget));
});

// One goal per open GitHub issue (source defaults to where the repository was imported from).
app.post("/api/repos/:repo/issues/import", async (c) => {
	const input = await body(
		c.req.raw,
		z.object({
			source: z.string().nullish(),
			labels: z.array(z.string()).nullish(),
			excludeLabels: z.array(z.string()).nullish(),
			limit: z.number().int().min(1).max(200).nullish(),
			token: z.string().max(500).nullish(),
		}),
	);
	const { source, labels, excludeLabels, limit, token } = input;
	return c.json(
		await coordinator(c.executionCtx.exports, c.req.param("repo")).importIssues({
			source: source ?? undefined,
			labels: labels ?? undefined,
			excludeLabels: excludeLabels ?? undefined,
			limit: limit ?? undefined,
			token: token || undefined,
		}),
		201,
	);
});

// How each model has done on this repository.
app.get("/api/repos/:repo/models", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).models()));

// What the work in this repository cost: totals by model, purpose, goal and change.
app.get("/api/repos/:repo/costs", async (c) => c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).costs()));

app.post("/api/repos/:repo/goals/:goalId/assign", async (c) => {
	const { model } = await body(c.req.raw, z.object({ model: z.string().optional() }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).assign(c.req.param("goalId"), model), 201);
});

app.post("/api/repos/:repo/goals/:goalId/race", async (c) => {
	const { models } = await body(c.req.raw, z.object({ models: z.array(z.string()).min(2).max(8) }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).race(c.req.param("goalId"), models), 201);
});

// External agents: claim a goal, declare intent, submit. Same operations as the MCP tools.
// Break a big goal into sub-goals with a planner model; agents start on them as dependencies land.
app.post("/api/repos/:repo/goals/:goalId/plan", async (c) => {
	const opts = await body(c.req.raw, z.object({
			model: z.string().optional(),
			agentModel: z.string().optional(),
			agentModels: z.array(z.string()).min(1).max(8).optional(),
			maxParallel: z.number().int().min(1).max(32).optional(),
		}),);
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).plan(c.req.param("goalId"), opts), 202);
});

app.post("/api/repos/:repo/goals/:goalId/claim", async (c) => {
	const { agentName, model } = await body(c.req.raw, z.object({ agentName: z.string(), model: z.string().default("external") }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).claim(c.req.param("goalId"), agentName, "cli", model), 201);
});

app.post("/api/repos/:repo/changes/:changeId/intent", async (c) => {
	const input = await body(
		c.req.raw,
		z.object({ summary: z.string().min(3), paths: z.array(z.string()).default([]), symbols: z.array(z.object({ path: z.string(), name: z.string() })).default([]) }),
	);
	const { overlaps, advice } = await coordinator(c.executionCtx.exports, c.req.param("repo")).declareIntent(c.req.param("changeId"), input);
	return c.json({ overlaps, advice });
});

// External agents may send their diff along (the CLI does), so the dashboard shows it before the
// merge box gets to the change.
app.post("/api/repos/:repo/changes/:changeId/submit", async (c) => {
	const raw = await c.req.raw.text();
	const extra = z
		.object({ diff: z.string().max(2_000_000).optional(), base: z.string().optional(), head: z.string().optional() })
		.parse(raw ? JSON.parse(raw) : {});
	const coord = coordinator(c.executionCtx.exports, c.req.param("repo"));
	if (extra.diff && extra.base && extra.head) await coord.recordDiff(c.req.param("changeId"), { source: "cli", base: extra.base, head: extra.head, diff: extra.diff });
	return c.json(await coord.submit(c.req.param("changeId")));
});

// Per-repo settings: decider ("clef" | "evidence") and landing batch size.
app.post("/api/repos/:repo/settings", async (c) => {
	const patch = await body(c.req.raw, z.object({
			decider: z.enum(["clef", "evidence"]).optional(),
			batchMax: z.number().int().min(1).max(256).optional(),
			security: z.boolean().optional(),
			goalBudget: z.number().positive().max(10_000).nullable().optional(),
		}),);
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).setSettings(patch));
});

// Load test with simulated agents (no containers, no model calls).
app.post("/api/repos/:repo/loadtest", async (c) => {
	const opts = await body(
		c.req.raw,
		z.object({
			agents: z.number().int().min(1).max(100_000),
			waveSize: z.number().int().min(1).max(500).default(50),
			sharedRate: z.number().min(0).max(1).default(0.05),
			brokenRate: z.number().min(0).max(1).default(0.01),
		}),
	);
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).loadTest(opts), 202);
});

app.get("/api/repos/:repo/stats", async (c) =>
	c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).stats(Number(c.req.query("since") ?? 0))),
);

app.post("/api/repos/:repo/races/:group/winner", async (c) => {
	const { changeId, by } = await body(c.req.raw, z.object({ changeId: z.string(), by: z.string().default("human") }));
	await coordinator(c.executionCtx.exports, c.req.param("repo")).pickRaceWinner(c.req.param("group"), changeId, by);
	return c.json({ ok: true });
});

// ── Changes ────────────────────────────────────────────────────────────────

app.get("/api/repos/:repo/changes/:changeId", async (c) => {
	const coord = coordinator(c.executionCtx.exports, c.req.param("repo"));
	const detail = await coord.changeDetail(c.req.param("changeId"));
	return detail ? c.json({ ...detail, cost: await coord.changeCost(c.req.param("changeId")) }) : c.json({ error: "not found" }, 404);
});

// The change's diff against its base, as last recorded (by its agent, then by the merge box).
app.get("/api/repos/:repo/changes/:changeId/diff", async (c) => {
	const d = await coordinator(c.executionCtx.exports, c.req.param("repo")).diffOf(c.req.param("changeId"));
	return d ? c.json(d) : c.json({ error: "no diff recorded yet" }, 404);
});

app.post("/api/repos/:repo/changes/:changeId/restart", async (c) =>
	c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).restartAgent(c.req.param("changeId"))),
);

app.post("/api/repos/:repo/changes/:changeId/abandon", async (c) => {
	const { by } = await body(c.req.raw, z.object({ by: z.string().default("human") }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).abandon(c.req.param("changeId"), by));
});

app.post("/api/repos/:repo/changes/:changeId/decision", async (c) => {
	const { outcome, by, note } = await body(c.req.raw, z.object({ outcome: z.enum(["land", "bounce"]), by: z.string().default("human"), note: z.string().optional() }));
	await coordinator(c.executionCtx.exports, c.req.param("repo")).humanDecision(c.req.param("changeId"), outcome, by, note);
	return c.json({ ok: true });
});

app.get("/api/sims/:agentId", async (c) => c.json(await simOf(c.executionCtx.exports, c.req.param("agentId")).status()));

app.get("/api/agents/:agentId/transcript", async (c) =>
	c.body(await agentOf(c.executionCtx.exports, c.req.param("agentId")).transcript(), 200, { "content-type": "application/json" }),
);

// ── Repo events ────────────────────────────────────────────────────────────

const PushEvent = z.object({
	type: z.literal("cf.artifacts.repo.pushed"),
	source: z.object({ repoName: z.string() }),
	payload: z.object({
		ref: z.string(),
		before: z.string(),
		after: z.string(),
		commits: z.array(z.object({ id: z.string(), message: z.string() })),
	}),
});

async function handleRepoEvent(exports: Cloudflare.Exports, raw: unknown) {
	const event = PushEvent.safeParse(raw);
	if (!event.success) return; // Hive only reacts to pushes
	const { source, payload } = event.data;
	if (payload.ref !== "refs/heads/main" || source.repoName.includes(".")) return; // trunk repos only, not forks/ledgers
	await coordinator(exports, source.repoName).onTrunkPush(
		payload.after,
		payload.commits.map((c) => ({ id: c.id, trailers: parseTrailers(c.message) })),
	);
}

// devhost delivers Artifacts-shaped push events here; in production they arrive through Queues.
app.post("/_dev/events", async (c) => {
	if (c.env.REPO_HOST === "artifacts") return c.json({ error: "not available" }, 404);
	await handleRepoEvent(c.executionCtx.exports, await c.req.json());
	return c.json({ ok: true });
});

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		if (pathname === "/mcp") {
			if (!(await authorized(request, env))) {
				const refused = await refuseMcpWrite(request);
				if (refused) return refused;
			}
			return handleMcp(request, env, ctx);
		}
		// Only the coordinator's event stream is exposed; agents and merge boxes are internal.
		const coordinatorRoute = /^\/agents\/coordinator\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
		if (coordinatorRoute) return coordinatorOf(ctx.exports, coordinatorRoute[1]).fetch(request);
		if (pathname.startsWith("/agents/")) return new Response("not found", { status: 404 });
		return app.fetch(request, env, ctx);
	},
	async queue(batch, _env, ctx) {
		for (const message of batch.messages) {
			try {
				await handleRepoEvent(ctx.exports, message.body);
				message.ack();
			} catch (err) {
				console.error("repo event failed", err);
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<Env>;
