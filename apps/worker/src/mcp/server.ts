import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { coordinatorOf } from "../bindings.ts";
import { EVENTS } from "../notify/notify.ts";
import { authenticatedRemote, ledgerRepo, repoHost } from "../repo/index.ts";

// Hive over MCP: any agent (Claude Code, Codex, a script) can join the swarm. It works in its
// own clone of a Hive fork with ordinary git, and uses these tools to coordinate with everyone else.

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

function createServer(env: Env, exports: Cloudflare.Exports) {
	const server = new McpServer({ name: "hive", version: "1.4.0" });
	const coordinator = (repo: string) => coordinatorOf(exports, repo);

	server.registerTool(
		"hive_status",
		{
			description: "Who is working on what in a Hive repo: goals, changes in flight, live intents, and the convergence queue.",
			inputSchema: { repo: z.string() },
		},
		async ({ repo }) => {
			const s = await coordinator(repo).snapshot();
			return text({
				goals: s.goals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
				changes: s.changes.filter((c) => c.status !== "archived").map((c) => ({ id: c.id, goal: c.goalId, agent: c.agentId, model: c.model, status: c.status })),
				intents: s.intents.map((i) => ({ change: i.changeId, agent: i.agentId, summary: i.summary, symbols: i.symbols.map((x) => `${x.path}#${x.name}`) })),
				queue: s.queue,
			});
		},
	);

	server.registerTool(
		"hive_symbols",
		{
			description: "Symbols Hive knows in a file (functions, classes, methods as Class.method). Use these names when declaring intent.",
			inputSchema: { repo: z.string(), path: z.string() },
		},
		async ({ repo, path }) => text(await coordinator(repo).symbolsIn(path)),
	);

	server.registerTool(
		"hive_import",
		{
			description:
				"Import an existing repository (GitHub or any https git server) into a new Hive repo. Its default branch becomes trunk's main. A token is only needed for private repositories and is not stored.",
			inputSchema: { url: z.string().url(), repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$/), branch: z.string().optional(), token: z.string().optional() },
		},
		async ({ url, repo, branch, token }) => text({ repo, ...(await coordinator(repo).importFrom({ url, branch, token })) }),
	);

	server.registerTool(
		"hive_plan",
		{
			description:
				"Have a planner break a big goal (e.g. 'fix the security issues', 'port this to Rust') into sub-goals with dependencies. Hive then starts agents on the sub-goals as their dependencies land, up to maxParallel at once.",
			inputSchema: {
				repo: z.string(),
				goal: z.string().describe("goal id"),
				model: z.string().optional().describe("planner model (default GLM 5.3)"),
				agentModels: z.array(z.string()).min(1).max(8).optional().describe("models for the sub-goals' agents, used in turn"),
				agentModel: z.string().optional().describe("one model for every sub-goal (same as agentModels with one entry)"),
				maxParallel: z.number().int().min(1).max(32).optional(),
			},
		},
		async ({ repo, goal, model, agentModels, agentModel, maxParallel }) => text(await coordinator(repo).plan(goal, { model, agentModels, agentModel, maxParallel })),
	);

	server.registerTool(
		"hive_create_goal",
		{
			description: "Create a goal (a desired outcome). Claim it yourself with hive_claim, or leave it for built-in agents.",
			inputSchema: {
				repo: z.string(),
				title: z.string(),
				description: z.string().default(""),
				budget: z.number().positive().optional().describe("USD the goal (with its sub-goals) may spend before its agents stop"),
			},
		},
		async ({ repo, title, description, budget }) => {
			const c = coordinator(repo);
			const goal = await c.createGoal({ title, description });
			if (budget) await c.setGoalBudget(goal.id, budget);
			return text({ ...goal, budget: budget ?? null });
		},
	);

	server.registerTool(
		"hive_claim",
		{
			description:
				"Claim a goal as an external agent. Hive forks trunk for you and returns a git clone command for your fork (write access, 1 hour) plus a read-only trunk remote for rebasing.",
			inputSchema: { repo: z.string(), goalId: z.string(), agentName: z.string().describe("A stable name for you, e.g. claude-code-laptop"), model: z.string().default("external") },
		},
		async ({ repo, goalId, agentName, model }) => {
			const claim = await coordinator(repo).claim(goalId, agentName, "mcp", model);
			return text({
				changeId: claim.changeId,
				clone: `git clone ${claim.cloneRemote} ${claim.changeId}`,
				trunkRemote: claim.trunkRemote,
				next: [
					"Explore, then call hive_declare_intent before editing.",
					"Commit with trailer lines `Hive-Change-Id: <changeId>` and `Hive-Goal: <goalId>`, push to your fork's main.",
					"Call hive_submit. Poll hive_change for evidence and the decision; on a bounce, rebase onto trunk and resubmit.",
				],
			});
		},
	);

	server.registerTool(
		"hive_declare_intent",
		{
			description: "Declare what you are about to change, BEFORE editing. Returns overlaps with other agents' live work and advice (proceed, narrow, wait, negotiate).",
			inputSchema: {
				repo: z.string(),
				changeId: z.string(),
				summary: z.string(),
				paths: z.array(z.string()),
				symbols: z.array(z.object({ path: z.string(), name: z.string() })),
			},
		},
		async ({ repo, changeId, ...intent }) => {
			const { overlaps, advice } = await coordinator(repo).declareIntent(changeId, intent);
			return text({ overlaps, advice });
		},
	);

	server.registerTool(
		"hive_submit",
		{
			description: "Submit your pushed fork to the convergence queue. Hive rebases it onto trunk, runs the tests, reviews it, and decides.",
			inputSchema: { repo: z.string(), changeId: z.string() },
		},
		async ({ repo, changeId }) => text(await coordinator(repo).submit(changeId)),
	);

	server.registerTool(
		"hive_change",
		{
			description: "Status of a change: intent, evidence (test results), review, and decisions including the reason for a bounce.",
			inputSchema: { repo: z.string(), changeId: z.string() },
		},
		async ({ repo, changeId }) => text(await coordinator(repo).changeDetail(changeId)),
	);

	server.registerTool(
		"hive_message",
		{
			description: "Send a message to another agent working in the repo, e.g. to agree on an interface when intents overlap.",
			inputSchema: { repo: z.string(), from: z.string(), to: z.string(), text: z.string() },
		},
		async ({ repo, from, to, text: body }) => {
			await coordinator(repo).message(from, to, body);
			return text("sent");
		},
	);

	// ── Running the hive: what the dashboard does, for an operator working from Claude Code ──

	server.registerTool(
		"hive_create_repo",
		{
			description: "Create an empty Hive repo (trunk and ledger). Push code to it with git (see hive_clone), or use hive_import for an existing repository.",
			inputSchema: { repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$/) },
		},
		async ({ repo }) => text(await coordinator(repo).init()),
	);

	server.registerTool(
		"hive_assign",
		{
			description: "Start one of Hive's built-in coding agents on a goal. It forks trunk, declares intent, writes the change and submits it. Omit model for the default.",
			inputSchema: { repo: z.string(), goal: z.string().describe("goal id"), model: z.string().optional().describe("Workers AI model id, e.g. @cf/moonshotai/kimi-k2.7-code") },
		},
		async ({ repo, goal, model }) => text(await coordinator(repo).assign(goal, model)),
	);

	server.registerTool(
		"hive_race",
		{
			description: "Race several models on one goal: each gets its own fork; when all finish, Clef picks the candidate that best does the goal (or use hive_pick_winner).",
			inputSchema: { repo: z.string(), goal: z.string().describe("goal id"), models: z.array(z.string()).min(2).max(8) },
		},
		async ({ repo, goal, models }) => text(await coordinator(repo).race(goal, models)),
	);

	server.registerTool(
		"hive_pick_winner",
		{
			description: "Pick a race's winner yourself instead of waiting for Clef. The other candidates are archived.",
			inputSchema: { repo: z.string(), group: z.string().describe("race group id (change.race.group)"), changeId: z.string() },
		},
		async ({ repo, group, changeId }) => {
			await coordinator(repo).pickRaceWinner(group, changeId, "human:mcp");
			return text({ ok: true });
		},
	);

	server.registerTool(
		"hive_decide",
		{
			description: "Make the call on a change that needs a person (status 'escalated'): land it (its checks still run first) or send it back with a note.",
			inputSchema: { repo: z.string(), changeId: z.string(), outcome: z.enum(["land", "bounce"]), note: z.string().optional() },
		},
		async ({ repo, changeId, outcome, note }) => {
			await coordinator(repo).humanDecision(changeId, outcome, "human:mcp", note);
			return text({ ok: true });
		},
	);

	server.registerTool(
		"hive_restart",
		{
			description: "Restart a built-in agent on its change (after it stalled or its container was replaced).",
			inputSchema: { repo: z.string(), changeId: z.string() },
		},
		async ({ repo, changeId }) => text(await coordinator(repo).restartAgent(changeId)),
	);

	server.registerTool(
		"hive_abandon",
		{
			description: "Archive a change and release its intent, so others can touch that code.",
			inputSchema: { repo: z.string(), changeId: z.string() },
		},
		async ({ repo, changeId }) => text(await coordinator(repo).abandon(changeId, "human:mcp")),
	);

	server.registerTool(
		"hive_run_checks",
		{
			description: "Run the repo's checks (hive.json or detected; plus the security scan if on) on trunk in a merge box. Takes a minute or two. Good right after an import.",
			inputSchema: { repo: z.string() },
		},
		async ({ repo }) => text(await coordinator(repo).checkTrunk()),
	);

	server.registerTool(
		"hive_settings",
		{
			description:
				"Read a repo's settings, or change them: goalBudget (default USD per goal), security (scan every batch), decider ('clef' = evidence plus a model review; 'evidence' = checks alone), batchMax (1-256). Also returns what Hive checks.",
			inputSchema: {
				repo: z.string(),
				security: z.boolean().optional(),
				decider: z.enum(["clef", "evidence"]).optional(),
				batchMax: z.number().int().min(1).max(256).optional(),
				goalBudget: z.number().positive().nullable().optional().describe("default USD budget per goal; null for no limit"),
			},
		},
		async ({ repo, ...patch }) => {
			const c = coordinator(repo);
			const changed = Object.values(patch).some((v) => v !== undefined);
			const settings = changed ? await c.setSettings(patch) : await c.settings();
			return text({ settings, checks: await c.checkPlan() });
		},
	);

	server.registerTool(
		"hive_clone",
		{
			description: "A git clone command for a repo's trunk, or its ledger (every intent, evidence run, review and decision as files), valid for one hour. Read-only unless write is true.",
			inputSchema: { repo: z.string(), ledger: z.boolean().optional(), write: z.boolean().optional() },
		},
		async ({ repo, ledger, write }) => {
			const name = ledger ? ledgerRepo(repo) : repo;
			const host = repoHost(env);
			const found = await host.get(name);
			if (!found) return text(`no repository named ${name}`);
			const token = await host.token(name, write ? "write" : "read", 3600);
			return text({ command: `git clone ${authenticatedRemote(found.remote, token)} ${name}`, expiresIn: 3600 });
		},
	);

	server.registerTool(
		"hive_costs",
		{
			description:
				"What the work in a repo cost, at Workers AI and Containers prices: total, by model, by purpose (agent, review, clef, planner, boxes), by goal with budgets. Pass changeId for one change.",
			inputSchema: { repo: z.string(), changeId: z.string().optional() },
		},
		async ({ repo, changeId }) => text(changeId ? await coordinator(repo).changeCost(changeId) : await coordinator(repo).costs()),
	);

	server.registerTool(
		"hive_import_issues",
		{
			description:
				"Turn open GitHub issues into goals, one each, linked back to the issue (skips ones already imported). Source defaults to the repo this one was imported from. Then start agents with hive_assign or hive_plan.",
			inputSchema: {
				repo: z.string(),
				source: z.string().optional().describe("owner/repo or a GitHub URL"),
				labels: z.array(z.string()).optional().describe("only issues with all of these labels"),
				excludeLabels: z.array(z.string()).optional().describe("skip issues with any of these labels"),
				limit: z.number().int().min(1).max(200).optional(),
				token: z.string().optional().describe("GitHub token for private repositories or rate limits; used once, not stored"),
			},
		},
		async ({ repo, ...input }) => text(await coordinator(repo).importIssues(input)),
	);

	server.registerTool(
		"hive_github",
		{
			description:
				"A repo's GitHub connection: where trunk is mirrored, pull requests opened per achieved goal, the last upstream sync, any error. action 'sync' runs a sync now; 'options' sets mirror/prs/pull; 'disconnect' removes the stored token. Connect from the dashboard or CLI (it needs a token).",
			inputSchema: {
				repo: z.string(),
				action: z.enum(["status", "sync", "options", "disconnect"]).default("status"),
				mirror: z.boolean().optional(),
				prs: z.boolean().optional(),
				pull: z.boolean().optional(),
			},
		},
		async ({ repo, action, mirror, prs, pull }) => {
			const c = coordinator(repo);
			if (action === "sync") await c.githubSync();
			if (action === "options") return text(await c.setGitHubOptions({ mirror, prs, pull }));
			if (action === "disconnect") return text(await c.disconnectGitHub());
			return text(await c.githubStatus());
		},
	);

	server.registerTool(
		"hive_notifications",
		{
			description:
				"Webhooks a repo calls when a change needs a person, a goal lands, a race finishes, or trunk fails: list, add (Slack and Discord URLs get their own format; others get signed JSON), test, remove.",
			inputSchema: {
				repo: z.string(),
				action: z.enum(["list", "add", "test", "remove"]).default("list"),
				url: z.string().url().optional(),
				events: z.array(z.enum(EVENTS)).optional(),
				hookId: z.string().optional(),
			},
		},
		async ({ repo, action, url, events, hookId }) => {
			const c = coordinator(repo);
			if (action === "add") {
				if (!url) return text("add needs url");
				return text(await c.addHook({ url, events }));
			}
			if (action === "test" || action === "remove") {
				if (!hookId) return text(`${action} needs hookId`);
				return text(action === "test" ? await c.testHook(hookId) : await c.removeHook(hookId));
			}
			return text(await c.listHooks());
		},
	);

	server.registerTool(
		"hive_why",
		{
			description:
				"Why a line of trunk is what it is: the commit that last changed it and, when Hive landed it, the goal, the agent's declared intent, the evidence, the review and Clef's decision. Ask before changing code you don't understand.",
			inputSchema: { repo: z.string(), path: z.string(), line: z.number().int().min(1) },
		},
		async ({ repo, path, line }) => text(await coordinator(repo).why(path, line)),
	);

	server.registerTool(
		"hive_comment",
		{
			description:
				"Review comments on a change: add one on a line of its diff (path + line) or on the whole change, then 'send' delivers the pending ones to its agent (a change waiting for a person goes back to its agent with them).",
			inputSchema: {
				repo: z.string(),
				changeId: z.string(),
				action: z.enum(["add", "send", "list"]).default("add"),
				body: z.string().optional(),
				path: z.string().optional(),
				line: z.number().int().min(1).optional(),
			},
		},
		async ({ repo, changeId, action, body, path, line }) => {
			const c = coordinator(repo);
			if (action === "send") return text(await c.sendComments(changeId, "mcp"));
			if (action === "list") return text(await c.comments(changeId));
			if (!body) return text("add needs body");
			return text(await c.addComment({ changeId, path: path ?? null, line: line ?? null, body, author: "mcp" }));
		},
	);

	server.registerTool(
		"hive_retry",
		{
			description:
				"Try a goal again from a fresh fork after a change didn't work out: optionally another model and guidance. The new agent is told what the earlier attempt ran into (its decision, failing checks, review comments). replace archives the earlier attempt.",
			inputSchema: { repo: z.string(), changeId: z.string(), model: z.string().optional(), guidance: z.string().optional(), replace: z.boolean().optional() },
		},
		async ({ repo, changeId, ...opts }) => text(await coordinator(repo).tryAgain(changeId, { ...opts, by: "mcp" })),
	);

	server.registerTool(
		"hive_models",
		{
			description:
				"How each model has done on a repo: changes started and landed, landing rate, times sent back or escalated, median minutes to land, cost per landed change. Use it to pick models.",
			inputSchema: { repo: z.string() },
		},
		async ({ repo }) => text(await coordinator(repo).models()),
	);

	server.registerTool(
		"hive_set_budget",
		{
			description: "Set a goal's budget in USD (covers its sub-goals), or null to remove it. Agents stop when it's reached; raise it and hive_restart to continue.",
			inputSchema: { repo: z.string(), goal: z.string(), budget: z.number().positive().nullable() },
		},
		async ({ repo, goal, budget }) => text(await coordinator(repo).setGoalBudget(goal, budget)),
	);

	return server;
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
	return createMcpHandler(() => createServer(env, ctx.exports), { route: "/mcp" })(request, env, ctx);
}
