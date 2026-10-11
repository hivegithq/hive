// devhost: a local stand-in for Cloudflare Artifacts, so Hive runs without a paid plan.
// Same operations as the binding (create, fork, log, readFile, listFiles, tokens),
// real Git smart-HTTP via `git http-backend`, and Artifacts-shaped push events.
//
//   node tools/devhost/server.ts            # listens on :8788, stores repos in .devhost/
//   DEVHOST_EVENTS_URL=http://localhost:5173/_dev/events  forwards push events to the Worker

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";

const PORT = Number(process.env.DEVHOST_PORT ?? 8788);
const ROOT = resolve(process.env.DEVHOST_ROOT ?? ".devhost/repos");
// Containers reach the host through host.docker.internal; the Worker uses localhost.
const PUBLIC_URL = process.env.DEVHOST_PUBLIC_URL ?? `http://localhost:${PORT}`;
const EVENTS_URL = process.env.DEVHOST_EVENTS_URL;
const NAMESPACE = "dev";

mkdirSync(ROOT, { recursive: true });

const repoDir = (name: string) => join(ROOT, `${name}.git`);
const validName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name);
const handle = (name: string) => ({ name, remote: `${PUBLIC_URL}/git/${NAMESPACE}/${name}.git`, defaultBranch: "main" });

function git(args: string[], opts: { cwd?: string; input?: Buffer } = {}): Promise<{ code: number; stdout: Buffer; stderr: string }> {
	return new Promise((done) => {
		const p = spawn("git", args, { cwd: opts.cwd });
		const out: Buffer[] = [];
		let err = "";
		p.stdout.on("data", (d) => out.push(d));
		p.stderr.on("data", (d) => (err += d));
		p.on("close", (code) => done({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err }));
		p.stdin.end(opts.input);
	});
}

async function mustGit(args: string[], cwd?: string): Promise<string> {
	const r = await git(args, { cwd });
	if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout.toString();
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function refs(dir: string): Promise<Map<string, string>> {
	const out = await git(["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: dir });
	return new Map(
		out.stdout
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => l.split(" ") as [string, string]),
	);
}

const SEP = "\x1f";
const REC = "\x1e";
async function log(dir: string, ref: string, limit: number) {
	const r = await git(["log", "--first-parent", `-n${limit}`, `--format=%H${SEP}%an${SEP}%ae${SEP}%cn${SEP}%ce${SEP}%P${SEP}%ct${SEP}%B${REC}`, ref, "--"], { cwd: dir });
	if (r.code !== 0) return [];
	return r.stdout
		.toString()
		.split(REC)
		.map((s) => s.replace(/^\n/, ""))
		.filter(Boolean)
		.map((rec) => {
			const [hash, an, ae, cn, ce, parents, ct, message] = rec.split(SEP);
			return {
				hash,
				message: message.replace(/\n$/, ""),
				author: { name: an, email: ae },
				committer: { name: cn, email: ce },
				parents: parents ? parents.split(" ") : [],
				committedAt: Number(ct),
			};
		});
}

async function emitPushes(name: string, before: Map<string, string>, after: Map<string, string>) {
	if (!EVENTS_URL) return;
	const zero = "0".repeat(40);
	for (const [ref, sha] of after) {
		const prev = before.get(ref) ?? zero;
		if (prev === sha) continue;
		const range = prev === zero ? sha : `${prev}..${sha}`;
		const commits = (await log(repoDir(name), range, 20)).map((c) => ({
			id: c.hash,
			message: c.message,
			messageTruncated: false,
			timestamp: new Date(c.committedAt * 1000).toISOString(),
			author: c.author,
			committer: c.committer,
			parents: c.parents,
		}));
		const event = {
			type: "cf.artifacts.repo.pushed",
			source: { type: "artifacts.repo", namespace: NAMESPACE, repoName: name },
			payload: { ref, before: prev, after: sha, commits, totalCommitsCount: commits.length, commitsTruncated: false },
			metadata: { accountId: "dev", eventSubscriptionId: "dev", eventSchemaVersion: 1, eventTimestamp: new Date().toISOString() },
		};
		fetch(EVENTS_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) }).catch((e) =>
			console.warn(`devhost: event delivery failed: ${e.message}`),
		);
	}
}

// Git smart-HTTP through `git http-backend` (CGI).
async function smartHttp(req: IncomingMessage, res: ServerResponse, name: string, rest: string, query: string) {
	const dir = repoDir(name);
	if (!existsSync(dir)) return json(res, 404, { error: "not found" });
	// Like Artifacts, every git request needs a token (devhost accepts any, it only checks presence).
	if (!req.headers.authorization) {
		res.writeHead(401, { "www-authenticate": 'Basic realm="devhost"' }).end();
		return;
	}
	const before = rest === "/git-receive-pack" ? await refs(dir) : null;
	const body = await readBody(req);
	const env = {
		...process.env,
		GIT_PROJECT_ROOT: ROOT,
		GIT_HTTP_EXPORT_ALL: "1",
		PATH_INFO: `/${name}.git${rest}`,
		REQUEST_METHOD: req.method ?? "GET",
		QUERY_STRING: query,
		CONTENT_TYPE: req.headers["content-type"] ?? "",
		CONTENT_LENGTH: String(body.length),
		REMOTE_USER: "hive",
		GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
	};
	const p = spawn("git", ["http-backend"], { env });
	const out: Buffer[] = [];
	p.stdout.on("data", (d) => out.push(d));
	p.stderr.on("data", (d) => process.stderr.write(d));
	p.stdin.end(body);
	await new Promise((r) => p.on("close", r));

	const raw = Buffer.concat(out);
	const split = raw.indexOf("\r\n\r\n");
	const headerText = raw.subarray(0, split).toString();
	let status = 200;
	const headers: Record<string, string> = {};
	for (const line of headerText.split("\r\n")) {
		const i = line.indexOf(":");
		const key = line.slice(0, i).trim();
		const value = line.slice(i + 1).trim();
		if (key.toLowerCase() === "status") status = Number(value.split(" ")[0]);
		else headers[key] = value;
	}
	res.writeHead(status, headers).end(raw.subarray(split + 4));
	if (before) await emitPushes(name, before, await refs(dir));
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
	const parts = url.pathname.split("/").filter(Boolean).slice(2).map(decodeURIComponent); // after /api/repos
	const [name, action] = parts;

	if (req.method === "POST" && parts.length === 0) {
		const { name: newName } = JSON.parse((await readBody(req)).toString());
		if (!validName(newName)) return json(res, 400, { error: "INVALID_REPO_NAME" });
		if (existsSync(repoDir(newName))) return json(res, 409, { error: "ALREADY_EXISTS" });
		await mustGit(["init", "--bare", "-q", "-b", "main", repoDir(newName)]);
		await mustGit(["config", "http.receivepack", "true"], repoDir(newName));
		return json(res, 201, handle(newName));
	}
	if (!name || !existsSync(repoDir(name))) return json(res, 404, { error: "NOT_FOUND" });

	if (req.method === "GET" && !action) return json(res, 200, handle(name));
	if (req.method === "POST" && action === "fork") {
		const { name: target } = JSON.parse((await readBody(req)).toString());
		if (!validName(target)) return json(res, 400, { error: "INVALID_REPO_NAME" });
		if (existsSync(repoDir(target))) return json(res, 409, { error: "ALREADY_EXISTS" });
		await mustGit(["clone", "--bare", "-q", "--single-branch", "--branch", "main", repoDir(name), repoDir(target)]);
		await mustGit(["config", "http.receivepack", "true"], repoDir(target));
		return json(res, 201, handle(target));
	}
	if (req.method === "POST" && action === "tokens") {
		const { scope = "write", ttl = 3600 } = JSON.parse((await readBody(req)).toString() || "{}");
		const expires = Math.floor(Date.now() / 1000) + ttl;
		return json(res, 201, { id: randomBytes(4).toString("hex"), plaintext: `dev_${randomBytes(20).toString("hex")}?expires=${expires}`, scope });
	}
	if (req.method === "GET" && action === "log") {
		const commits = await log(repoDir(name), url.searchParams.get("ref") ?? "main", Number(url.searchParams.get("limit") ?? 50));
		return json(res, 200, commits);
	}
	if (req.method === "GET" && action === "file") {
		const r = await git(["show", `${url.searchParams.get("ref") ?? "main"}:${url.searchParams.get("path")}`], { cwd: repoDir(name) });
		if (r.code !== 0) return json(res, 404, { error: "NOT_FOUND" });
		res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(r.stdout);
		return;
	}
	if (req.method === "GET" && action === "files") {
		const r = await git(["ls-tree", "-r", "--name-only", url.searchParams.get("ref") ?? "main"], { cwd: repoDir(name) });
		return json(res, 200, r.code === 0 ? r.stdout.toString().split("\n").filter(Boolean) : []);
	}
	json(res, 404, { error: "unknown route" });
}

createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	try {
		if (url.pathname.startsWith("/api/repos")) return await api(req, res, url);
		const m = /^\/git\/[^/]+\/([^/]+)\.git(\/.*)$/.exec(url.pathname);
		if (m) return await smartHttp(req, res, decodeURIComponent(m[1]), m[2], url.search.slice(1));
		json(res, 404, { error: "not found" });
	} catch (err) {
		console.error(err);
		json(res, 500, { error: String(err) });
	}
}).listen(PORT, () => console.log(`devhost: ${PUBLIC_URL} (repos in ${ROOT})`));
