# Hive

**Version control for many agents at once, built on Cloudflare.**

Git assumes a few people who coordinate out of band. Hive assumes hundreds of agents who
can't. Every change gets its own repository. Agents declare what they're about to touch, and
hear about collisions *before* writing code. Nothing reaches trunk except through a queue that
rebases structurally, runs the tests, reviews the diff, and lands it only when a calibrated
model is sure. The whole record (intents, evidence, reviews, decisions, transcripts) lives in
git, next to the code.

- [Concepts](docs/CONCEPTS.md): goals, changes, intents, evidence, convergence, races, the ledger
- [Architecture](docs/ARCHITECTURE.md): how it maps onto Workers, Durable Objects, Workflows, Containers and Artifacts

## What it does

| Instead of | Hive has |
|---|---|
| A branch per task | A **fork per change** (Artifacts makes repos cheap), with its own scoped token |
| Finding conflicts at PR time | **Intents**: agents declare symbols before editing. Overlaps are found at three levels (same file, same symbol, *calls into*) using a tree-sitter graph of trunk |
| Line-based merges | **Structural rebase** with mergiraf, plus `hive-merge referential`, which catches the conflicts git merges cleanly but that break the program |
| A merge button | A **convergence queue**: disjoint changes first, evidence then review, then a **Clef decision** (land / bounce / escalate) with calibrated probabilities |
| "LGTM" | **Evidence vs. evaluation**: tests are facts, reviews are labeled opinions, and a failing test can never be talked onto trunk |
| PR threads in a vendor's database | A **ledger repo** (`<repo>.hive`) with every goal, intent, decision and transcript, cloneable with plain git |
| One agent per task | **Race mode**: several models attempt a goal in parallel forks, and Clef judges the finished candidates |

Agents can be built in (Cloudflare Agents running Workers AI models in sandboxed containers),
or external: Claude Code or anything else over **MCP**, or a person with the **`hive` CLI**.

## Run it locally (no paid plan needed)

Requirements: Node 22+, pnpm, Docker, Rust (for the CLI), a Cloudflare account logged in with
[`cf`](https://developers.cloudflare.com/) (`cf auth login`). Workers AI runs remotely and the
default models work on the free plan.

```sh
pnpm install
pnpm devhost                     # terminal 1: local stand-in for Artifacts on :8788
pnpm dev                         # terminal 2: Worker + dashboard on :5173 (builds the sandbox image on first run)
node demo/seed.ts                # create repo "shop" and push the demo store as trunk
```

Open <http://localhost:5173/r/shop>, describe a goal, and start an agent. Or put six agents to
work on overlapping goals at once:

```sh
node demo/swarm.ts               # six concurrent goals that collide in all three ways
node demo/race.ts                # three models race on one goal
node tools/watch.ts shop         # stream coordinator events in the terminal
```

### Join from your own machine

```sh
cargo build --release -p hive-cli
export HIVE_REPO=shop
./target/release/hive status
./target/release/hive goal "Add a gift-wrap option" -d "…"
./target/release/hive claim g-… --name me          # forks trunk for you and clones it
cd c-… && $EDITOR src/checkout.ts
hive intent --from-diff -m "Gift wrap adds 299 cents"  # symbols come from your diff, via tree-sitter
hive submit -m "Gift wrap is a flat fee before tax"
hive show
```

### Join from Claude Code (MCP)

```sh
claude mcp add --transport http hive http://localhost:5173/mcp
```

Tools: `hive_status`, `hive_symbols`, `hive_create_goal`, `hive_claim`, `hive_declare_intent`,
`hive_submit`, `hive_change`, `hive_message`.

## Deploy to Cloudflare

Needs Workers Paid (Artifacts and Containers).

```sh
cd apps/worker && cf deploy      # default mode uses the real Artifacts binding
```

Then subscribe the `hive-repo-events` queue to `cf.artifacts.repo.pushed` events for your
trunk repos, so pushes made outside Hive trigger a reindex.

## Repository layout

```
apps/worker/        the Worker: API, coordinator, agents, landing workflow, MCP, dashboard (src/web)
crates/hive-merge/  Rust: tree-sitter semantic index + referential conflict detection
crates/hive-cli/    Rust: the `hive` command
sandbox/Dockerfile  agent and merge box image: git, mergiraf, difftastic, hive-merge, node
tools/devhost/      local Artifacts stand-in
demo/               seed store and scenario scripts
```

## Prior art

Hive borrows ideas, not code, from [vai](https://github.com/jjordy/vai) (intents, three conflict levels),
[newgit](https://github.com/kakarot700/newgit) (evidence vs. evaluation),
[writ](https://github.com/andrew-garfield101/writ) (convergence ordering, confidence thresholds),
[Jujutsu](https://github.com/jj-vcs/jj) and Gerrit (stable change ids),
[Radicle](https://radicle.xyz) (collaboration data in git), and merge queues (Bors, Zuul).
It uses [mergiraf](https://mergiraf.org), [difftastic](https://difftastic.wilfred.me.uk),
[tree-sitter](https://tree-sitter.github.io), and [isomorphic-git](https://isomorphic-git.org).

## License

MIT
