import { tool } from "ai";
import { z } from "zod";
import type { Box } from "../sandbox/box.ts";
import { sh } from "../sandbox/box.ts";

export const REPO_DIR = "/workspace/repo";

export interface ToolHost {
	box: Box;
	declareIntent(input: { summary: string; paths: string[]; symbols: { path: string; name: string }[] }): Promise<string>;
	message(to: string, text: string): Promise<void>;
	drainInbox(): string[];
	submit(message: string): Promise<string>;
	syncTrunk(): Promise<string>;
}

const clip = (s: string, max = 12000) => (s.length > max ? `…[${s.length - max} chars elided]…\n${s.slice(-max)}` : s);

async function run(host: ToolHost, command: string, timeoutMs?: number) {
	const r = await host.box.run(command, { cwd: REPO_DIR, timeoutMs });
	return { exitCode: r.exitCode, output: clip(`${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`) };
}

export function codingTools(host: ToolHost) {
	return {
		list_files: tool({
			description: "List tracked files in the repository, optionally under a directory.",
			inputSchema: z.object({ dir: z.string().optional() }),
			execute: async ({ dir }) => run(host, `git ls-files ${dir ? sh(dir) : ""} | head -400`),
		}),
		read_file: tool({
			description: "Read a file with line numbers. Use startLine/endLine for large files.",
			inputSchema: z.object({ path: z.string(), startLine: z.number().int().optional(), endLine: z.number().int().optional() }),
			execute: async ({ path, startLine, endLine }) =>
				run(host, `nl -ba ${sh(path)} | sed -n '${startLine ?? 1},${endLine ?? 400}p'`),
		}),
		search: tool({
			description: "Search the repository with ripgrep (regex).",
			inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
			execute: async ({ pattern, path }) => run(host, `rg -n --max-count 40 --max-columns 200 -e ${sh(pattern)} ${path ? sh(path) : ""}`),
		}),
		edit_file: tool({
			description: "Replace one exact occurrence of oldText with newText in a file. oldText must be unique in the file.",
			inputSchema: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
			execute: async ({ path, oldText, newText }) => {
				const files = host.box.files();
				const full = `${REPO_DIR}/${path}`;
				const current = await (await files.readFile(full)).text();
				const count = current.split(oldText).length - 1;
				if (count !== 1) return { ok: false, error: `oldText matched ${count} times; include more context so it is unique` };
				await files.writeFile(full, current.replace(oldText, () => newText));
				return { ok: true };
			},
		}),
		write_file: tool({
			description: "Create or overwrite a file with the given content.",
			inputSchema: z.object({ path: z.string(), content: z.string() }),
			execute: async ({ path, content }) => {
				const full = `${REPO_DIR}/${path}`;
				await host.box.run(`mkdir -p "$(dirname ${sh(full)})"`);
				await host.box.files().writeFile(full, content);
				return { ok: true };
			},
		}),
		run: tool({
			description: "Run a shell command in the repository (tests, typecheck, build). Output is truncated.",
			inputSchema: z.object({ command: z.string() }),
			execute: async ({ command }) => run(host, command, 10 * 60 * 1000),
		}),
		declare_intent: tool({
			description:
				"Declare what you are about to change BEFORE editing: a summary, the files, and the symbols. Returns overlaps with other agents' work and advice.",
			inputSchema: z.object({
				summary: z.string(),
				paths: z.array(z.string()),
				symbols: z.array(z.object({ path: z.string(), name: z.string() })).describe('e.g. {path:"src/cart.ts", name:"Cart.total"}'),
			}),
			execute: async (input) => host.declareIntent(input),
		}),
		message_agent: tool({
			description: "Send a message to another agent (e.g. to agree on an interface when your intents overlap).",
			inputSchema: z.object({ agentId: z.string(), text: z.string() }),
			execute: async ({ agentId, text }) => {
				await host.message(agentId, text);
				return { sent: true };
			},
		}),
		check_inbox: tool({
			description: "Read messages other agents or Hive sent you.",
			inputSchema: z.object({}),
			execute: async () => ({ messages: host.drainInbox() }),
		}),
		sync_trunk: tool({
			description: "Fetch the latest trunk and rebase your work onto it (structural merge). Reports conflicts to resolve.",
			inputSchema: z.object({}),
			execute: async () => host.syncTrunk(),
		}),
		submit: tool({
			description: "Commit all changes and submit them to the convergence queue. Ends your turn.",
			inputSchema: z.object({ message: z.string().describe("Commit message: what changed and why") }),
			execute: async ({ message }) => host.submit(message),
		}),
	};
}
