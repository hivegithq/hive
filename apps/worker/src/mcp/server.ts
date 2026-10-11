import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { coordinatorOf } from "../bindings.ts";

// Hive over MCP: any agent (Claude Code, Codex, a script) can join the swarm. It works in its
// own clone of a Hive fork with ordinary git, and uses these tools to coordinate with everyone else.

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

function createServer(env: Env) {
	const server = new McpServer({ name: "hive", version: "0.1.0" });
	const coordinator = (repo: string) => coordinatorOf(env, repo);

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
		"hive_create_goal",
		{
			description: "Create a goal (a desired outcome). Claim it yourself with hive_claim, or leave it for built-in agents.",
			inputSchema: { repo: z.string(), title: z.string(), description: z.string().default("") },
		},
		async ({ repo, title, description }) => text(await coordinator(repo).createGoal({ title, description })),
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

	return server;
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext) {
	return createMcpHandler(() => createServer(env), { route: "/mcp" })(request, env, ctx);
}
