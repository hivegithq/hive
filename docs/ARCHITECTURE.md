# Hive architecture

Hive is one Cloudflare Worker plus a container image. Everything stateful is a Durable Object.

```
                       ┌──────────────────────────── Worker (Hono API + dashboard + /mcp) ─────────────────────────────┐
  dashboard ── WS ──▶  │  RepoCoordinator (DO, one per trunk repo)                                                     │
  hive CLI ── REST ──▶ │    goals · changes · intents · semantic graph · convergence queue · ledger · decisions        │
  Claude Code ─ MCP ─▶ │    the only writer to trunk: batched landings, one trunk lease                                │
                       │        │ start / bounce / land                     │ create                                    │
                       │        ▼                                           ▼                                           │
                       │  CodingAgent (Agent DO, one per change)      LandingWorkflow (Workflows, one per batch)       │
                       │    model loop on Workers AI, in a fiber        rebase → referential → evidence → review →     │
                       │    checkpointed every step                     Clef decision → push trunk / bounce / escalate │
                       │        │ exec                                      │ RPC                                       │
                       │        ▼                                           ▼                                           │
                       │  agent container                             MergeBox (DO + container)                        │
                       │    git · node · ripgrep                        git + mergiraf driver · difftastic · hive-merge │
                       │        │ all HTTP(S)                               │ all HTTP(S)                               │
                       │        ▼                                           ▼                                           │
                       │  Outbound (WorkerEntrypoint): allowlist per sandbox, injects repo-scoped tokens                │
                       └───────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                                   ▼
                              Artifacts: <repo> (trunk) · <repo>.c-<id> (one fork per change) · <repo>.hive (ledger)
                                         <repo>.preview (race candidates → Workers Builds previews)
```

## Components

| Piece | Product | Source |
|---|---|---|
| API, landing page, dashboard, MCP | Worker + static assets (Vite, React, Kumo, Motion) | `apps/worker/src/index.ts`, `src/web/`, `src/mcp/` |
| Coordinator | Agents SDK `Agent` (Durable Object, SQLite) | `src/coordinator/RepoCoordinator.ts` |
| Coding agent | `Agent` with an attached Container | `src/agent/` |
| Merge box | Durable Object with an attached Container (`standard-4`), two per repo | `src/landing/MergeBox.ts` |
| Batch landing | Divide-and-conquer culprit search, additive-conflict union | `src/landing/batch.ts`, `src/landing/union.ts` |
| Fork pool | Up to 32 mirror repos per trunk, refreshed after each batch | `src/coordinator/forks.ts` |
| Load testing | `SimAgent`: real git, real forks, no model | `src/agent/SimAgent.ts` |
| Landing pipeline | Workflows | `src/landing/LandingWorkflow.ts` |
| Decisions | Workers AI `@cf/cloudflare/clef-flash` | `src/decide/` |
| Credential boundary | `WorkerEntrypoint` as the containers' outbound gateway | `src/sandbox/outbound.ts` |
| Ledger writes | isomorphic-git over an in-memory FS, from the Worker | `src/ledger/` |
| Repos | Artifacts binding (or `tools/devhost` locally) | `src/repo/` |
| Semantic graph, referential conflicts | Rust, tree-sitter (runs in the container) | `crates/hive-merge` |
| CLI | Rust | `crates/hive-cli` |

## Decisions worth explaining

**Fork per change, not branch per change.** Artifacts makes repos cheap. A repo per change
gives real isolation: separate tokens, no shared refs, and nothing an agent can do to its
fork touches anyone else.

**Explicit submit, push events only on trunk.** Artifacts push events are subscribed per
repository. Rather than create a subscription for every fork, agents call `submit` and the
coordinator verifies the fork's head with the binding. Trunk subscribes to push events, so a
human pushing with plain git still triggers a reindex.

**A single writer to trunk.** Artifacts doesn't document compare-and-swap ref updates, so
Hive doesn't rely on them. Up to two batch workflows run at once so fork fetching overlaps, but
only the holder of the coordinator's trunk lease verifies and pushes. The push is a plain
fast-forward of the exact commit the evidence ran on. If trunk moved anyway (a person pushed
with plain git), the push fails, and the batch is restacked and re-verified once before
anything lands.

**Scale comes from spreading load, not a bigger single writer.** Trunk keeps one writer, so a
repository's throughput is how fast one batch can be fetched, stacked and verified. Measured
under load, the expensive parts were never git itself:

- Fetching forks is CPU-bound in the merge container (TLS plus git, about a second each on half
  a vCPU, at any parallelism). Merge boxes run on `standard-4`; two of them pipeline batches.
- A thousand agents cloning one repository overloads it. Only merge boxes read trunk: agents
  clone their own fork, retries clone one of 32 fork mirrors, and mirrors are refreshed from
  trunk after every batch.
- Long calls into a container get cut off. Forks are fetched in short, retried workflow steps,
  and the box re-fetches anything a restart lost before it stacks.
- Bisecting a red batch re-applied every accepted change on each attempt. Attempts now build on
  the last verified stack.

With those, one repository lands about 125 changes a minute from 2,000 agents (README, "What's
been verified"). Every repository has its own coordinator, merge boxes and mirrors.

**Credentials never enter a container.** Containers start with internet off. Every HTTP(S)
request goes through the `Outbound` entrypoint with a per-sandbox policy: which repos, read
or write, and which extra hosts (the npm registry). Outbound mints a short-lived, repo-scoped
token for each git request. A prompt-injected agent can't exfiltrate a credential it never had,
and can't push anywhere but its own fork.

**Tree-sitter runs natively, in Rust, in the container.** Workers forbid compiling
WebAssembly at runtime, which is how web-tree-sitter loads grammars. `hive-merge` is a small
Rust binary in the sandbox image instead, so the same code powers indexing in the cloud and
`hive intent --from-diff` on a laptop.

**Calibrated decisions, not pass/fail.** Clef returns probabilities for typed questions
(score, choice, yes/no). Hive turns them into policy: land at ≥ 0.85 after discounting by agent
trust, bounce when bounce is more likely, otherwise ask a person. Deterministic evidence
failing always bounces; no model can talk a failing test onto trunk.

**Durable agent loops.** Each agent's model loop runs inside `runFiber` and checkpoints the
conversation after every step. If the Durable Object is evicted mid-task (deploys, restarts),
the agent resumes from its last step. Models that end a turn without submitting get nudged
back to work a bounded number of times.

## Local development

Artifacts has no local simulation and requires Workers Paid, so `cf dev --mode devhost`
swaps in `tools/devhost`: a Node server with the same operations (create, fork, log, read,
tokens), real git smart-HTTP via `git http-backend`, and Artifacts-shaped push events posted
to the Worker. Containers run in local Docker and address devhost as `http://devhost.hive.internal`,
a name only the outbound gateway resolves (to `DEVHOST_URL`), so local git traffic takes the same
policy-checked path as production. `pnpm start` runs devhost and the Worker together.
Workers AI and Clef always run remotely, including on the free plan.
