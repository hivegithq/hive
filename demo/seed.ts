// Create a Hive repo and push demo/seed-shop as its first trunk commit, using plain git.
//
//   node demo/seed.ts [repo] [hive-url]
//   defaults: repo "shop", hive http://localhost:5173

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.argv[2] ?? "shop";
const hive = process.argv[3] ?? process.env.HIVE_URL ?? "http://localhost:5173";

async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${hive}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
	return res.json() as Promise<T>;
}

await post("/api/repos", { name: repo });
const { command } = await post<{ command: string }>(`/api/repos/${repo}/clone`, { scope: "write" });
const remote = command.split(" ")[2];

const dir = mkdtempSync(join(tmpdir(), "hive-seed-"));
try {
	cpSync(new URL("./seed-shop", import.meta.url).pathname, dir, { recursive: true, filter: (src) => !src.includes("node_modules") });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git("-c", "user.name=Hive Demo", "-c", "user.email=demo@hive.local", "commit", "-q", "-m", "Shop: cart, pricing, discounts, checkout");
	git("push", "-q", remote, "main");
	console.log(`Seeded ${repo} at ${git("rev-parse", "--short", "HEAD")}. Open ${hive}/r/${repo}`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
