import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type { RepoHost } from "../repo/host.ts";
import { tokenSecret } from "../repo/host.ts";
import { MemoryFS } from "./memfs.ts";

// The ledger repo (<repo>.hive) holds Hive's record of how trunk came to be: goals, intents,
// evidence, evaluations, decisions and agent transcripts, as plain JSON in git. Anyone can
// clone it and audit why each change landed, without Hive.

export type LedgerFiles = Record<string, unknown>; // path → JSON value

const DIR = "/ledger";
const AUTHOR = { name: "Hive", email: "ledger@hive.local" };

export async function writeLedger(host: RepoHost, ledgerRepo: string, files: LedgerFiles, message: string): Promise<string | null> {
	const handle = await host.get(ledgerRepo);
	if (!handle) throw new Error(`ledger repo ${ledgerRepo} does not exist`);
	const token = tokenSecret(await host.token(ledgerRepo, "write", 300));
	const onAuth = () => ({ username: "x", password: token });
	const fs = new MemoryFS();

	const hasHistory = (await host.log(ledgerRepo, { limit: 1 })).length > 0;
	if (hasHistory) {
		await git.clone({ fs, http, dir: DIR, url: handle.remote, ref: "main", singleBranch: true, depth: 1, onAuth });
	} else {
		await git.init({ fs, dir: DIR, defaultBranch: "main" });
	}

	let changed = false;
	for (const [path, value] of Object.entries(files)) {
		const text = `${JSON.stringify(value, null, 2)}\n`;
		const full = `${DIR}/${path}`;
		const before = await fs.promises.readFile(full, "utf8").catch(() => null);
		if (before === text) continue;
		await fs.promises.writeFile(full, text);
		await git.add({ fs, dir: DIR, filepath: path });
		changed = true;
	}
	if (!changed) return null;

	const sha = await git.commit({ fs, dir: DIR, message, author: AUTHOR });
	await git.push({ fs, http, dir: DIR, url: handle.remote, ref: "main", onAuth });
	return sha;
}
