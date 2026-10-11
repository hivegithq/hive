import { bindings, defineConfig, defineContainer, exports, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Agent workspaces and the merge box share one image (git, mergiraf, difftastic, node, hive-merge),
// but a Container links to exactly one Durable Object class, so each gets its own definition.
const image = { sandbox: { dockerfile: "../../sandbox/Dockerfile", buildContext: "../.." } };
const agentBox = defineContainer({ name: "hive-agent-box", schedulingPolicy: "durable-object", images: image });
const mergeBox = defineContainer({ name: "hive-merge-box", schedulingPolicy: "durable-object", images: image });

export default defineConfig(({ mode }) => {
	// `cf dev --mode devhost` talks to tools/devhost instead of Artifacts (no paid plan needed).
	// Every other mode, including `cf deploy`, uses real Artifacts.
	const local = mode === "devhost";
	return {
		containers: [agentBox, mergeBox],
		worker: {
			name: "hive",
			compatibilityDate: "2026-09-25",
			compatibilityFlags: ["nodejs_compat"],
			entrypoint,
			assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*", "/agents/*", "/_dev/*", "/mcp"] },
			observability: { enabled: true },
			env: {
				ASSETS: bindings.assets(),
				AI: bindings.ai({ dev: { remote: true } }),
				// Artifacts has no local simulation and needs a paid plan, so devhost mode leaves it out.
				...(local ? {} : { ARTIFACTS: bindings.artifacts({ namespace: "hive", dev: { remote: true } }) }),
				LANDING: bindings.workflow({ name: "hive-landing", worker: "hive", exportName: "LandingWorkflow" }),
				REPO_HOST: bindings.text(local ? "devhost" : "artifacts"),
				DEVHOST_URL: bindings.text("http://localhost:8788"),
				// How containers address devhost. A made-up hostname, so every request goes through the
				// Outbound gateway (host.docker.internal would bypass interception in local Docker).
				DEVHOST_CONTAINER_URL: bindings.text("http://devhost.hive.internal"),
				// Required for writes outside devhost mode: `cf workers secrets put HIVE_TOKEN` (or the dashboard).
				...(local ? {} : { HIVE_TOKEN: bindings.secret() }),
				CODER_MODEL: bindings.text("@cf/moonshotai/kimi-k2.7-code"),
				REVIEW_MODEL: bindings.text("@cf/deepseek-ai/deepseek-v4-pro-0813"),
			},
			exports: {
				RepoCoordinator: exports.durableObject({ storage: "sqlite" }),
				CodingAgent: exports.durableObject({ storage: "sqlite", container: agentBox }),
				MergeBox: exports.durableObject({ storage: "sqlite", container: mergeBox }),
				ModelGate: exports.durableObject({ storage: "sqlite" }),
				SimAgent: exports.durableObject({ storage: "sqlite" }),
				LandingWorkflow: exports.workflow({ name: "hive-landing" }),
				Outbound: exports.worker(),
			},
			triggers: [triggers.queue({ name: "hive-repo-events", maxBatchSize: 10, maxRetries: 5 })],
		},
	};
});
