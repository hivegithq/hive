// Typed access to this Worker's own Durable Objects (through its exports, so they stay local
// classes the deploy can attach containers to) and to the landing Workflow.
import type { LandingParams } from "./coordinator/RepoCoordinator.ts";

type Exports = Cloudflare.Exports;

export const coordinatorOf = (ex: Exports, repo: string) => ex.RepoCoordinator.getByName(repo);
export const agentOf = (ex: Exports, agentId: string) => ex.CodingAgent.getByName(agentId);
export const mergeBoxOf = (ex: Exports, name: string) => ex.MergeBox.getByName(name);
export const simOf = (ex: Exports, agentId: string) => ex.SimAgent.getByName(agentId);
export const plannerOf = (ex: Exports, plannerId: string) => ex.PlannerAgent.getByName(plannerId);
export const gateOf = (ex: Exports, model: string) => ex.ModelGate.getByName(model);
export const landing = (env: Env) => env.LANDING as Workflow<LandingParams>;
