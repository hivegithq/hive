import { bindings, defineConfig, defineContainer, exports, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Self-hosting knobs (environment variables, or git-ignored files at the repository root):
//   HIVE_WORKER_NAME  Worker name; also prefixes the workflow, queue and containers so two Hives can
//                     share an account (default "hive")
//   HIVE_NAMESPACE    Artifacts namespace (default: the worker name)
//   HIVE_DOMAIN       a domain in your account to serve on, apex and www (or a .hive-domain file);
//                     without one, Hive serves on <name>.<account>.workers.dev only
//   OPENAI_API_KEY    (or a line in .env) run agents on an OpenAI-compatible endpoint: set as a secret when
//                     you deploy. OPENAI_BASE_URL points it elsewhere (OpenRouter, Together, Groq, Ollama...);
//                     BYO_INPUT_USD_PER_M / BYO_OUTPUT_USD_PER_M let Hive count what it costs
//   HIVE_EMAIL_FROM   send email notifications from this address (or a .hive-email file); its domain
//                     needs Email Routing, and recipients must be verified destination addresses
//   HIVE_CLERK_PUBLISHABLE_KEY  sign people in with Clerk (or a .hive-clerk file): signed-in users can
//                     make changes from the dashboard. Without it, the dashboard asks for HIVE_TOKEN.
// The config runs in Node; declared here rather than pulling Node's types into the Worker's.
declare const process: {
	env: Record<string, string | undefined>;
	cwd(): string;
	getBuiltinModule(id: "node:fs"): { existsSync(path: string): boolean; readFileSync(path: string, encoding: "utf8"): string };
};
const fromFile = (name: string) => {
	const fs = process.getBuiltinModule("node:fs");
	const path = `${process.cwd()}/../../${name}`; // cf runs from apps/worker
	return fs.existsSync(path) ? fs.readFileSync(path, "utf8").trim() || undefined : undefined;
};
const NAME = process.env.HIVE_WORKER_NAME || "hive";
const NAMESPACE = process.env.HIVE_NAMESPACE || NAME;
const DOMAIN = process.env.HIVE_DOMAIN || fromFile(".hive-domain");
const CLERK_KEY = process.env.HIVE_CLERK_PUBLISHABLE_KEY || fromFile(".hive-clerk");
const EMAIL_FROM = process.env.HIVE_EMAIL_FROM || fromFile(".hive-email");
// Bring your own model: an OpenAI-compatible endpoint. The key is a secret (set by the deploy); this only
// decides which bindings exist, from the environment or lines in the root .env.
const dotenv = (name: string) => process.env[name] || new RegExp(`^${name}=(\\S+)`, "m").exec(fromFile(".env") ?? "")?.[1];
const BYO_KEY = dotenv("OPENAI_API_KEY");
const BYO_URL = dotenv("OPENAI_BASE_URL");
const BYO_IN = dotenv("BYO_INPUT_USD_PER_M");
const BYO_OUT = dotenv("BYO_OUTPUT_USD_PER_M");

// Agent workspaces and the merge box share one image (git, mergiraf, difftastic, node, hive-merge),
// but a Container links to exactly one Durable Object class, so each gets its own definition.
const image = { sandbox: { dockerfile: "../../sandbox/Dockerfile", buildContext: "../.." } };
const agentBox = defineContainer({ name: `${NAME}-agent-box`, schedulingPolicy: "durable-object", images: image });
const mergeBox = defineContainer({ name: `${NAME}-merge-box`, schedulingPolicy: "durable-object", images: image });

export default defineConfig(({ mode }) => {
	// `cf dev --mode devhost` talks to tools/devhost instead of Artifacts (no paid plan needed).
	// Every other mode, including `cf deploy`, uses real Artifacts.
	const local = mode === "devhost";
	return {
		containers: [agentBox, mergeBox],
		worker: {
			name: NAME,
			compatibilityDate: "2026-09-25",
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*", "/agents/*", "/_dev/*", "/mcp"] },
			observability: { enabled: true },
			// Keep hive.<account>.workers.dev serving alongside hivegit.dev: links, MCP setups and
			// clone URLs in the wild use it.
			workersDev: true,
			env: {
				ASSETS: bindings.assets(),
				AI: bindings.ai({ dev: { remote: true } }),
				// Artifacts has no local simulation and needs a paid plan, so devhost mode leaves it out.
				...(local ? {} : { ARTIFACTS: bindings.artifacts({ namespace: NAMESPACE, dev: { remote: true } }) }),
				LANDING: bindings.workflow({ name: `${NAME}-landing`, worker: NAME, exportName: "LandingWorkflow" }),
				// Bring your own model: an OpenAI-compatible endpoint's key (and URL, prices) from the environment or .env.
				...(BYO_KEY ? { OPENAI_API_KEY: bindings.secret() } : {}),
				...(BYO_URL ? { OPENAI_BASE_URL: bindings.text(BYO_URL) } : {}),
				...(BYO_IN ? { BYO_INPUT_USD_PER_M: bindings.text(BYO_IN) } : {}),
				...(BYO_OUT ? { BYO_OUTPUT_USD_PER_M: bindings.text(BYO_OUT) } : {}),
				...(EMAIL_FROM ? { EMAIL: bindings.sendEmail(), EMAIL_FROM: bindings.text(EMAIL_FROM) } : {}),
				// Dependencies installed by one box, restored by the next (keyed by lockfiles).
				CACHE: bindings.r2({ name: `${NAME}-cache` }),
				REPO_HOST: bindings.text(local ? "devhost" : "artifacts"),
				DEVHOST_URL: bindings.text("http://localhost:8788"),
				// How containers address devhost. A made-up hostname, so every request goes through the
				// Outbound gateway (host.docker.internal would bypass interception in local Docker).
				DEVHOST_CONTAINER_URL: bindings.text("http://devhost.hive.internal"),
				// Required for writes outside devhost mode: `cf workers secrets put HIVE_TOKEN` (or the dashboard).
				...(local ? {} : { HIVE_TOKEN: bindings.secret() }),
				// Clerk's publishable key (public): the Worker accepts session tokens signed by that instance.
				// Not in devhost mode, where a production key wouldn't work on localhost anyway.
				CLERK_PUBLISHABLE_KEY: bindings.text(local ? "" : (CLERK_KEY ?? "")),
				CODER_MODEL: bindings.text("@cf/moonshotai/kimi-k2.7-code"),
				REVIEW_MODEL: bindings.text("@cf/deepseek-ai/deepseek-v4-pro-0813"),
			},
			exports: {
				RepoCoordinator: exports.durableObject({ storage: "sqlite" }),
				CodingAgent: exports.durableObject({ storage: "sqlite", container: agentBox }),
				MergeBox: exports.durableObject({ storage: "sqlite", container: mergeBox }),
				ModelGate: exports.durableObject({ storage: "sqlite" }),
				SimAgent: exports.durableObject({ storage: "sqlite" }),
				PlannerAgent: exports.durableObject({ storage: "sqlite" }),
				LandingWorkflow: exports.workflow({ name: `${NAME}-landing` }),
				Outbound: exports.worker(),
			},
			triggers: [
				triggers.queue({ name: `${NAME}-repo-events`, maxBatchSize: 10, maxRetries: 5 }),
				// A custom domain (its zone needs proxied DNS records pointing at the Worker; `pnpm self-host` adds
				// them). workers.dev stays up too.
				...(local || !DOMAIN
					? []
					: [triggers.fetch({ pattern: `${DOMAIN}/*`, zone: DOMAIN }), triggers.fetch({ pattern: `www.${DOMAIN}/*`, zone: DOMAIN })]),
			],
		},
	};
});
