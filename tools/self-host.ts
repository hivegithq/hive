// Deploy your own Hive to your Cloudflare account, in one command:
//
//   pnpm self-host                         # Hive on hive.<account>.workers.dev
//   HIVE_DOMAIN=example.dev pnpm self-host # also on example.dev (a zone in the same account)
//   HIVE_WORKER_NAME=hive2 pnpm self-host  # a second Hive on the same account
//
// Safe to run again: it creates only what's missing and redeploys. Needs Workers Paid (Artifacts,
// Containers, Queues), Docker running (the sandbox image builds locally), and `cf auth login`.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKER = join(ROOT, "apps/worker");
const NAME = process.env.HIVE_WORKER_NAME || "hive";
const NAMESPACE = process.env.HIVE_NAMESPACE || NAME;
const DOMAIN = process.env.HIVE_DOMAIN || (existsSync(join(ROOT, ".hive-domain")) ? readFileSync(join(ROOT, ".hive-domain"), "utf8").trim() : "");
const suffix = NAME === "hive" ? "" : `.${NAME}`;
const TOKEN_FILE = join(ROOT, `.hive-token${suffix}`);
const SECRETS_FILE = join(WORKER, `.secrets${suffix}.json`);

const step = (n: number, text: string) => console.log(`\n\x1b[33m${n}.\x1b[0m ${text}`);
const ok = (text: string) => console.log(`   \x1b[32m✓\x1b[0m ${text}`);
const warn = (text: string) => console.log(`   \x1b[33m!\x1b[0m ${text}`);
function fail(text: string): never {
	console.error(`\n   \x1b[31m✗\x1b[0m ${text}\n`);
	process.exit(1);
}

// `cf` from the worker package (a dev dependency; no global install needed).
function cf(args: string[], opts: { inherit?: boolean } = {}) {
	const r = spawnSync("pnpm", ["exec", "cf", ...args], { cwd: WORKER, encoding: "utf8", stdio: opts.inherit ? "inherit" : "pipe", env: { ...process.env, HIVE_WORKER_NAME: NAME, HIVE_NAMESPACE: NAMESPACE, ...(DOMAIN ? { HIVE_DOMAIN: DOMAIN } : {}) } });
	return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

console.log(`\nSetting up Hive "${NAME}"${DOMAIN ? ` on ${DOMAIN}` : ""}.`);

step(1, "Checking what's needed");
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) fail(`Node 22 or newer is needed (this is ${process.versions.node}).`);
ok(`Node ${process.versions.node}`);
if (!has("git", ["--version"])) fail("git isn't installed.");
ok("git");
if (!has("docker", ["info"])) fail("Docker isn't running. Hive's sandbox image (git, merge tools, Node, Rust, Python, Go, scanners) builds locally. Start Docker and run this again.");
ok("Docker is running");
if (!existsSync(join(WORKER, "node_modules"))) {
	console.log("   installing dependencies (pnpm install)");
	execFileSync("pnpm", ["install"], { cwd: ROOT, stdio: "inherit" });
}
const who = cf(["auth", "whoami"]);
if (who.code !== 0 || /not logged in|login/i.test(who.out)) fail("Log in to Cloudflare first: pnpm --filter @hive/worker exec cf auth login");
ok("Logged in to Cloudflare");

step(2, `Artifacts namespace "${NAMESPACE}"`);
const ns = cf(["artifacts", "namespaces", "create", "--namespace", NAMESPACE]);
if (ns.code === 0) ok("created");
else if (/already exists|ALREADY_EXISTS|409/i.test(ns.out)) ok("already there");
else
	warn(
		`couldn't create it from here (${ns.out.match(/\[\d+\][^\n]*/)?.[0] ?? "see below"}). If the deploy reports a missing namespace, create "${NAMESPACE}" under Storage → Artifacts in the dashboard, or log in again with \`cf auth login\` and rerun.`,
	);

step(3, `Queue "${NAME}-repo-events" (trunk push events)`);
const q = cf(["queues", "create", "--queue-name", `${NAME}-repo-events`]);
if (q.code === 0) ok("created");
else if (/already (exists|taken)|11009|409/i.test(q.out)) ok("already there");
else fail(`couldn't create the queue:\n${q.out}`);

step(3, `R2 bucket "${NAME}-cache" (dependency cache shared by merge and agent boxes)`);
const bucket = cf(["r2", "buckets", "create", "--name", `${NAME}-cache`]);
if (bucket.code === 0) ok("created");
else if (/already exists|10004|409/i.test(bucket.out)) ok("already there");
else fail(`couldn't create the bucket:\n${bucket.out}`);

step(4, "Access token for writes");
let token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : "";
if (!token) {
	token = randomBytes(24).toString("hex");
	writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
	ok(`generated and saved to ${TOKEN_FILE.replace(ROOT, "")} (git-ignored)`);
} else ok(`using the one in ${TOKEN_FILE.replace(ROOT, "")}`);
writeFileSync(SECRETS_FILE, JSON.stringify({ HIVE_TOKEN: token }), { mode: 0o600 });

if (DOMAIN) {
	step(5, `DNS for ${DOMAIN}`);
	const list = cf(["dns", "records", "list", "--zone", DOMAIN]);
	if (list.code !== 0) fail(`${DOMAIN} isn't a zone in this account (or isn't reachable):\n${list.out}`);
	for (const host of [DOMAIN, `www.${DOMAIN}`]) {
		if (list.out.includes(`"${host}"`)) {
			ok(`${host} has a record already`);
			continue;
		}
		const body = JSON.stringify({ type: "AAAA", name: host, content: "100::", proxied: true, ttl: 1, comment: `Placeholder: the ${NAME} Worker route serves this` });
		const r = cf(["dns", "records", "create", "--zone", DOMAIN, "--body", body]);
		if (r.code !== 0) fail(`couldn't add a DNS record for ${host}:\n${r.out}`);
		ok(`${host} → the Worker (proxied placeholder record)`);
	}
}

step(DOMAIN ? 6 : 5, "Building and deploying (the first build takes a while: it compiles the sandbox image)");
const deploy = cf(["deploy", "--secrets-file", SECRETS_FILE], { inherit: true });
if (deploy.code !== 0) fail("The deploy failed; the output above says why.");

const workersDev = cf(["workers", "get", NAME]).out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
const url = DOMAIN ? `https://${DOMAIN}` : (workersDev ?? `https://${NAME}.<your-subdomain>.workers.dev`);
console.log(`
\x1b[32mHive is deployed.\x1b[0m

  Open        ${url}
  Token       ${TOKEN_FILE.replace(ROOT, "")}   (the dashboard asks for it the first time you make a change)

  Try it:
    HIVE_TOKEN=$(cat ${TOKEN_FILE.replace(ROOT, "")}) node demo/seed.ts shop ${url}
    open ${url}/r/shop

  Connect Claude Code:
    claude mcp add --transport http hive ${url}/mcp --header "Authorization: Bearer $(cat ${TOKEN_FILE.replace(ROOT, "")})"

  Docs: https://hivegit.dev/docs
`);
