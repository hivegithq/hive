// A small in-memory filesystem with the fs.promises surface isomorphic-git uses.
// Workers have no persistent disk; each ledger sync clones, writes, commits and pushes in memory.

type Node = { kind: "file"; data: Uint8Array; mtimeMs: number } | { kind: "dir"; mtimeMs: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

function err(code: string, path: string) {
	const e = new Error(`${code}: ${path}`) as Error & { code: string };
	e.code = code;
	return e;
}

const norm = (p: string) => {
	const parts: string[] = [];
	for (const seg of p.split("/")) {
		if (!seg || seg === ".") continue;
		if (seg === "..") parts.pop();
		else parts.push(seg);
	}
	return `/${parts.join("/")}`;
};
const parent = (p: string) => norm(p).replace(/\/[^/]*$/, "") || "/";

class Stat {
	private node: Node;
	constructor(node: Node) {
		this.node = node;
	}
	get mtimeMs() {
		return this.node.mtimeMs;
	}
	get ctimeMs() {
		return this.node.mtimeMs;
	}
	get size() {
		return this.node.kind === "file" ? this.node.data.byteLength : 0;
	}
	get mode() {
		return this.node.kind === "file" ? 0o100644 : 0o40000;
	}
	readonly uid = 1;
	readonly gid = 1;
	readonly dev = 1;
	readonly ino = 1;
	isFile() {
		return this.node.kind === "file";
	}
	isDirectory() {
		return this.node.kind === "dir";
	}
	isSymbolicLink() {
		return false;
	}
}

export class MemoryFS {
	private nodes = new Map<string, Node>([["/", { kind: "dir", mtimeMs: Date.now() }]]);

	promises = {
		readFile: async (path: string, opts?: { encoding?: string } | string) => {
			const node = this.nodes.get(norm(path));
			if (!node) throw err("ENOENT", path);
			if (node.kind !== "file") throw err("EISDIR", path);
			const encoding = typeof opts === "string" ? opts : opts?.encoding;
			return encoding ? dec.decode(node.data) : node.data;
		},
		writeFile: async (path: string, data: string | Uint8Array) => {
			await this.promises.mkdir(parent(path), { recursive: true });
			this.nodes.set(norm(path), { kind: "file", data: typeof data === "string" ? enc.encode(data) : data, mtimeMs: Date.now() });
		},
		unlink: async (path: string) => {
			if (!this.nodes.delete(norm(path))) throw err("ENOENT", path);
		},
		readdir: async (path: string) => {
			const dir = norm(path);
			const node = this.nodes.get(dir);
			if (!node) throw err("ENOENT", path);
			if (node.kind !== "dir") throw err("ENOTDIR", path);
			const prefix = dir === "/" ? "/" : `${dir}/`;
			const names = new Set<string>();
			for (const key of this.nodes.keys()) {
				if (key !== dir && key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
			}
			return [...names];
		},
		mkdir: async (path: string, opts?: { recursive?: boolean }) => {
			const p = norm(path);
			const existing = this.nodes.get(p);
			if (existing) {
				if (opts?.recursive && existing.kind === "dir") return;
				throw err("EEXIST", path);
			}
			if (!this.nodes.has(parent(p))) {
				if (!opts?.recursive) throw err("ENOENT", path);
				await this.promises.mkdir(parent(p), { recursive: true });
			}
			this.nodes.set(p, { kind: "dir", mtimeMs: Date.now() });
		},
		rmdir: async (path: string) => {
			const p = norm(path);
			if ((await this.promises.readdir(p)).length > 0) throw err("ENOTEMPTY", path);
			this.nodes.delete(p);
		},
		stat: async (path: string) => {
			const node = this.nodes.get(norm(path));
			if (!node) throw err("ENOENT", path);
			return new Stat(node);
		},
		lstat: async (path: string) => this.promises.stat(path),
		readlink: async (path: string): Promise<string> => {
			throw err("EINVAL", path);
		},
		symlink: async (_target: string, path: string) => {
			throw err("ENOSYS", path);
		},
		chmod: async () => {},
	};
}
