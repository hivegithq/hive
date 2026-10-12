// Run Hive on your machine: `pnpm start`.
//
// Starts devhost (a local stand-in for Artifacts, on :8788) and the Worker's dev server (on :5173)
// together. No paid plan needed; Workers AI still runs on Cloudflare, so log in once with
// `pnpm --filter @hive/worker exec cf auth login`. Docker must be running: agents and the merge
// queue work in containers built from sandbox/Dockerfile (the first build takes a while).

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
function fail(text: string): never {
	console.error(`\n  \x1b[31m✗\x1b[0m ${text}\n`);
	process.exit(1);
}

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) fail(`Node 22 or newer is needed (this is ${process.versions.node}).`);
if (!has("git", ["--version"])) fail("git isn't installed (devhost serves repositories with git http-backend).");
if (!has("docker", ["info"])) fail("Docker isn't running. Start it and run `pnpm start` again.");
if (!existsSync(join(ROOT, "apps/worker/node_modules"))) spawnSync("pnpm", ["install"], { cwd: ROOT, stdio: "inherit" });
const who = spawnSync("pnpm", ["--filter", "@hive/worker", "exec", "cf", "auth", "whoami"], { cwd: ROOT, encoding: "utf8" });
if (who.status !== 0 || /not logged in/i.test(`${who.stdout}${who.stderr}`)) {
	fail("Log in to Cloudflare once (Workers AI runs there, free tier is fine): pnpm --filter @hive/worker exec cf auth login");
}

const children: ChildProcess[] = [];
function run(label: string, color: number, cmd: string, args: string[], env: Record<string, string> = {}) {
	const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env, FORCE_COLOR: "1" } });
	const prefix = `\x1b[${color}m${label.padEnd(8)}\x1b[0m`;
	const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
		let rest = "";
		stream.on("data", (d: Buffer) => {
			const lines = (rest + d.toString()).split("\n");
			rest = lines.pop() ?? "";
			for (const l of lines) out.write(`${prefix} ${l}\n`);
		});
	};
	pipe(child.stdout!, process.stdout);
	pipe(child.stderr!, process.stderr);
	child.on("exit", (code) => {
		console.log(`${prefix} exited (${code})`);
		for (const c of children) c.kill();
		process.exit(code ?? 0);
	});
	children.push(child);
}

console.log(`
  Starting Hive locally. When the dev server is ready:
    open http://localhost:5173            the landing page
    node demo/seed.ts                     seed a demo repository ("shop"), then open http://localhost:5173/r/shop
  Ctrl-C stops both.
`);
run("devhost", 36, "node", ["tools/devhost/server.ts"], { DEVHOST_EVENTS_URL: "http://localhost:5173/_dev/events" });
run("worker", 33, "pnpm", ["--filter", "@hive/worker", "dev"]);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => children.forEach((c) => c.kill(sig)));
