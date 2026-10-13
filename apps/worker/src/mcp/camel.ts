import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import type { ZodObject, ZodRawShape } from "zod";
import { agentOf } from "../bindings.ts";
import { codingTools, type ToolHost } from "../agent/tools.ts";

// Hive's agent tools, served to camelRun over MCP for one agent's run. The Worker has already checked
// the URL's signature (index.ts); each call is forwarded to that agent's sandbox.

// The tools' names, descriptions and schemas, without a workspace behind them.
const DEFS = codingTools(null as unknown as ToolHost) as unknown as Record<string, { description?: string; inputSchema: ZodObject<ZodRawShape> }>;

// camelRun runs its own turn-ending logic; Hive's `submit` ends the work, the others are plain tools.
function server(env: Env, exports: Cloudflare.Exports, agentId: string) {
	const s = new McpServer({ name: "hive-agent-tools", version: "1.9.1" });
	// The schemas are our own zod tool definitions; the SDK's overloads want its own zod typings.
	const register = s.registerTool.bind(s) as unknown as (name: string, config: { description: string; inputSchema: unknown }, handler: (args: unknown) => Promise<unknown>) => void;
	for (const [name, def] of Object.entries(DEFS)) {
		register(name, { description: def.description ?? name, inputSchema: def.inputSchema.shape }, async (args: unknown) => {
			try {
				const out = await agentOf(exports, agentId).camelTool(name, JSON.stringify(args ?? {}));
				return { content: [{ type: "text" as const, text: out }] };
			} catch (err) {
				return { content: [{ type: "text" as const, text: `Tool error: ${(err as Error).message}` }], isError: true };
			}
		});
	}
	return s;
}

export function handleCamelMcp(request: Request, env: Env, ctx: ExecutionContext, agentId: string) {
	return createMcpHandler(() => server(env, ctx.exports, agentId), { route: new URL(request.url).pathname })(request, env, ctx);
}
