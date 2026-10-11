// Typed access to this Worker's own Durable Objects and Workflow. The config references
// them by worker name (a self-reference can't be an object), so cf infers untyped namespaces.
import type { CodingAgent } from "./agent/CodingAgent.ts";
import type { LandingParams, RepoCoordinator } from "./coordinator/RepoCoordinator.ts";
import type { MergeBox } from "./landing/MergeBox.ts";

export const coordinatorOf = (env: Env, repo: string) => (env.COORDINATOR as DurableObjectNamespace<RepoCoordinator>).getByName(repo);
export const agentOf = (env: Env, agentId: string) => (env.CODING_AGENT as DurableObjectNamespace<CodingAgent>).getByName(agentId);
export const mergeBoxOf = (env: Env, name: string) => (env.MERGE_BOX as DurableObjectNamespace<MergeBox>).getByName(name);
export const landing = (env: Env) => env.LANDING as Workflow<LandingParams>;
