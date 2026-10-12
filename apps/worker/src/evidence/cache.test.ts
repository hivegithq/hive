import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseSetupResult, setupScript } from "./cache.ts";

// A fake curl that stores PUTs under $STORE and serves GETs from it (R2 behind the gateway).
const root = mkdtempSync(join(tmpdir(), "hive-cache-"));
const store = join(root, "store");
const bin = join(root, "bin");
mkdirSync(store);
mkdirSync(bin);
writeFileSync(
	join(bin, "curl"),
	`#!/bin/bash
method=GET; data=""; out=""; url=""
while [ $# -gt 0 ]; do case "$1" in
  -X) method="$2"; shift 2;; --data-binary) data="$2"; shift 2;; -o) out="$2"; shift 2;; -s*|-f*) shift;; *) url="$1"; shift;; esac; done
key=$(echo "$url" | sed 's|http://cache.hive.internal/||' | tr '/' '_')
if [ "$method" = PUT ]; then if [ "$data" = "@-" ]; then cat > "$STORE/$key"; else cp "\${data#@}" "$STORE/$key"; fi; exit 0; fi
[ -f "$STORE/$key" ] || exit 22
if [ -n "$out" ]; then cp "$STORE/$key" "$out"; else cat "$STORE/$key"; fi
`,
);
chmodSync(join(bin, "curl"), 0o755);

const run = (cwd: string, script: string) =>
	execFileSync("bash", ["-c", script], { cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STORE: store }, encoding: "utf8" });

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
	for (const k of ["k1", "k2", "k3"]) rmSync(`/tmp/hive-setup-${k}`, { force: true });
});

describe("dependency cache script", () => {
	for (const k of ["k1", "k2", "k3"]) rmSync(`/tmp/hive-setup-${k}`, { force: true });
	const spec = { local: ["node_modules"], absolute: [] as string[] };
	const install = "mkdir -p node_modules/left-pad && echo 'module.exports=1' > node_modules/left-pad/index.js";

	it("runs and saves on a miss, then restores in a fresh checkout without running", () => {
		const a = join(root, "box-a");
		mkdirSync(a);
		const first = parseSetupResult(run(a, setupScript({ key: "k1", command: install, prefix: "repo/", spec })));
		expect(first.cache).toBe("saved");

		// Another box: different directory, no marker. The install command would fail if it ran.
		rmSync("/tmp/hive-setup-k1", { force: true });
		const b = join(root, "box-b");
		mkdirSync(b);
		const second = parseSetupResult(run(b, setupScript({ key: "k1", command: "exit 1", prefix: "repo/", spec })));
		expect(second.cache).toBe("hit");
		expect(readFileSync(join(b, "node_modules/left-pad/index.js"), "utf8")).toContain("module.exports");

		// Same box again: the marker short-circuits.
		expect(parseSetupResult(run(b, setupScript({ key: "k1", command: "exit 1", prefix: "repo/", spec }))).cache).toBe("box");
	});

	it("misses when the key changes (a lockfile changed)", () => {
		const c = join(root, "box-c");
		mkdirSync(c);
		expect(parseSetupResult(run(c, setupScript({ key: "k2", command: install, prefix: "repo/", spec }))).cache).toBe("saved");
		expect(existsSync(join(store, "repo_k2_local_manifest"))).toBe(true);
	});

	it("runs plainly without a cache", () => {
		const d = join(root, "box-d");
		mkdirSync(d);
		expect(parseSetupResult(run(d, setupScript({ key: "k3", command: install, prefix: null, spec: null }))).cache).toBe("off");
	});
});
