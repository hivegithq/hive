import { ArtifactsRepoHost } from "./artifacts.ts";
import { DevRepoHost } from "./devhost.ts";
import type { RepoHost } from "./host.ts";

export function repoHost(env: Env): RepoHost {
	if (env.REPO_HOST !== "artifacts") return new DevRepoHost(env.DEVHOST_URL);
	if (!env.ARTIFACTS) throw new Error("REPO_HOST is artifacts but the ARTIFACTS binding is missing");
	return new ArtifactsRepoHost(env.ARTIFACTS);
}

// The remote a container should use. In dev, containers address devhost by a hostname only the Outbound gateway resolves.
export function containerRemote(env: Env, remote: string): string {
	return env.REPO_HOST === "artifacts" ? remote : remote.replace(env.DEVHOST_URL, env.DEVHOST_CONTAINER_URL);
}

// Repo naming: trunk "<repo>", ledger "<repo>.hive", one fork per change "<repo>.c-<id>".
export const ledgerRepo = (repo: string) => `${repo}.hive`;
export const changeRepo = (repo: string, changeId: string) => `${repo}.${changeId}`;

export * from "./host.ts";
