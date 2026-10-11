import { Hono } from "hono";
import { z } from "zod";
import { agentOf, coordinatorOf } from "./bindings.ts";
import { handleMcp } from "./mcp/server.ts";
import { authenticatedRemote, parseTrailers, repoHost } from "./repo/index.ts";

export { CodingAgent } from "./agent/CodingAgent.ts";
export { RepoCoordinator } from "./coordinator/RepoCoordinator.ts";
export { LandingWorkflow } from "./landing/LandingWorkflow.ts";
export { ModelGate } from "./agent/ModelGate.ts";
export { SimAgent } from "./agent/SimAgent.ts";
export { MergeBox } from "./landing/MergeBox.ts";
export { Outbound } from "./sandbox/outbound.ts";

const app = new Hono<{ Bindings: Env }>();
const coordinator = coordinatorOf;

const body = async <T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> => schema.parse(await req.json());

// Writes spend money (agents, containers, model calls) and change trunk, so they need the
// HIVE_TOKEN secret when one is set. Reads stay public: the dashboard, trunk and ledger are
// meant to be seen. In devhost mode with no secret configured, everything is open.
const authorized = (req: Request, env: Env) => {
	const token = (env as { HIVE_TOKEN?: string }).HIVE_TOKEN;
	if (!token) return env.REPO_HOST !== "artifacts";
	const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
	return given.length === token.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(given), new TextEncoder().encode(token));
};

app.use("/api/*", async (c, next) => {
	if (c.req.method === "GET" || authorized(c.req.raw, c.env)) return next();
	return c.json({ error: "unauthorized: send Authorization: Bearer <HIVE_TOKEN>" }, 401);
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
	const input = await body(c.req.raw, z.object({ title: z.string().min(3), description: z.string().default(""), parentId: z.string().optional() }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).createGoal(input), 201);
});

app.post("/api/repos/:repo/goals/:goalId/assign", async (c) => {
	const { model } = await body(c.req.raw, z.object({ model: z.string().optional() }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).assign(c.req.param("goalId"), model), 201);
});

app.post("/api/repos/:repo/goals/:goalId/race", async (c) => {
	const { models } = await body(c.req.raw, z.object({ models: z.array(z.string()).min(2).max(8) }));
	return c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).race(c.req.param("goalId"), models), 201);
});

// External agents: claim a goal, declare intent, submit. Same operations as the MCP tools.
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

app.post("/api/repos/:repo/changes/:changeId/submit", async (c) =>
	c.json(await coordinator(c.executionCtx.exports, c.req.param("repo")).submit(c.req.param("changeId"))),
);

// Per-repo settings: decider ("clef" | "evidence") and landing batch size.
app.post("/api/repos/:repo/settings", async (c) => {
	const patch = await body(c.req.raw, z.object({ decider: z.enum(["clef", "evidence"]).optional(), batchMax: z.number().int().min(1).max(256).optional() }));
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
	const detail = await coordinator(c.executionCtx.exports, c.req.param("repo")).changeDetail(c.req.param("changeId"));
	return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
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
			if (!authorized(request, env)) return Response.json({ error: "unauthorized" }, { status: 401 });
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
