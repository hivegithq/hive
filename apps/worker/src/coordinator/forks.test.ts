import { describe, expect, it } from "vitest";
import type { CommitInfo, RepoHandle, RepoHost } from "../repo/host.ts";
import { ForkPool, MAX_MIRRORS } from "./forks.ts";

// An Artifacts-like host where each fork takes `ms` and a source can only fork once at a time.
function fakeHost(ms: number) {
	const repos = new Set<string>(["shop"]);
	const forking = new Set<string>();
	let peak = 0;
	let active = 0;
	const host: RepoHost = {
		async create(name) {
			repos.add(name);
			return handle(name);
		},
		async fork(source, name) {
			if (forking.has(source)) throw Object.assign(new Error("FORK_IN_PROGRESS"), { code: "FORK_IN_PROGRESS" });
			forking.add(source);
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, ms));
			forking.delete(source);
			active--;
			repos.add(name);
			return handle(name);
		},
		async get(name) {
			return repos.has(name) ? handle(name) : null;
		},
		async token() {
			return "t";
		},
		async log(): Promise<CommitInfo[]> {
			return [];
		},
		async readFile() {
			return null;
		},
		async listFiles() {
			return [];
		},
	};
	return { host, repos, peak: () => peak };
}
const handle = (name: string): RepoHandle => ({ name, remote: `https://x/${name}.git`, defaultBranch: "main" });

describe("ForkPool", () => {
	it("never forks the same source twice at once, and grows mirrors under load", async () => {
		const { host, peak } = fakeHost(20);
		const mirrors: string[] = [];
		const pool = new ForkPool(host, "shop", { list: () => mirrors, add: (m) => mirrors.push(m) });
		const started = Date.now();
		await Promise.all(Array.from({ length: 200 }, (_, i) => pool.fork(`shop.c-${i}`, "")));
		const elapsed = Date.now() - started;
		expect(mirrors.length).toBeGreaterThan(4);
		expect(mirrors.length).toBeLessThanOrEqual(MAX_MIRRORS);
		expect(peak()).toBeGreaterThan(4); // forks really ran in parallel
		expect(elapsed).toBeLessThan(200 * 20 * 0.5); // far faster than 200 serial forks (4s)
	});

	it("uses trunk alone when demand is low", async () => {
		const { host } = fakeHost(1);
		const mirrors: string[] = [];
		const pool = new ForkPool(host, "shop", { list: () => mirrors, add: (m) => mirrors.push(m) });
		for (let i = 0; i < 5; i++) await pool.fork(`shop.c-${i}`, "");
		expect(mirrors).toEqual([]);
	});
});
