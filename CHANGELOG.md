# Changelog

All notable changes to Hive. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

## [1.8.0] - 2026-10-13

### Added
- **Repositories page** at [/repos](https://hivegit.dev/repos): every repository on a Hive, busiest
  first, with landed, in flight, needs you, spend and checks. `GET /api/repos`, `hive repos`. New
  repositories register themselves; the landing totals use the same list (they missed `hive`).
- **History by goal** under the map: each goal's attempts, how each ended, its sub-goals, pull
  request and cost; click an attempt to open it. `GET /api/repos/:repo/history`, `hive history`,
  `hive_history`.
- **Automatic fixing pass** (`autoFix`, off by default): when Clef isn't sure and the review raised
  concerns, one fixing pass starts per goal, within its budget.

## [1.7.0] - 2026-10-13

Rewinding and fixing agents' work, from [Delta](https://delta.dev)'s playbook, and a lighter site.

### Added
- **Carry on from step N:** a new attempt that keeps an earlier attempt's conversation up to a step,
  with its file edits and declared intent redone in a fresh fork, then your guidance or another
  model. Dashboard (Try again → Start from), `hive steps`, `hive rewind`, `hive_rewind`.
- **A fixing pass:** a fresh agent resolves a review's concerns (and your comments) on top of the
  attempt's work, then submits; the original is archived. `hive fix`, `hive_fix`.
- **Context window breakdown:** where a built-in agent's tokens went, per step, with the largest
  tool results named. `hive context`, `hive_context`.
- **Repository memory:** comments you send and send-back notes become lessons that every new agent
  on the repository is told; pause or remove them. `hive lessons`, `hive_lessons`.
- **A reviewer model per repository** (`reviewModel`, `hive settings --review-model`).
- **Pull requests from Hive itself:** Hive imported its own repository, passed its own checks
  (typecheck, vitest, `cargo test`), and opened hivegithq/hive#1 for a CONTRIBUTING.md.

### Fixed
- The dependency cache restored `node_modules` but skipped `corepack enable`, so restored boxes had
  no `pnpm`, trunk looked red, and the queue backed off. Setup now has a pre step that always runs.

### Changed
- Sign-in loads only when a visitor already has a session or asks to sign in or join the waitlist
  (Clerk's script, not the React SDK): about 145 KB gzipped less on every page.

## [1.6.0] - 2026-10-13

More from [Delta](https://delta.dev)'s playbook, and goals on a schedule.

### Added
- **Steer a working agent:** tell it something and it reads it before its next step (added to its
  instructions from then on). `hive steer`, `hive_steer`, the Conversation block in a change.
  Verified: an agent told to test `price.ts` did, while the same goal unsteered picked `discount.ts`.
- **Conversations visible:** messages to and from an agent, including other agents', show in its
  change.
- **Files seen:** tick files as you review; progress shows on the change, and a tick clears when the
  agent edits that file again.
- **Recurring goals:** a goal on a schedule (at least hourly), as one agent, a plan or a race, with a
  budget per run; skipped while the previous run is still going. Dashboard, `hive recurring`,
  `hive_recurring`.

## [1.5.0] - 2026-10-13

Reviewing agents' work, inspired by [Delta](https://delta.dev), and a public roadmap.

### Added
- **Review comments** on lines of a change's diff, or on the whole change, sent to its agent as one
  round: a change waiting for a person goes back with them, and a working agent gets them in its
  inbox. `hive comment`, `hive_comment`.
- **Try again**: a fresh attempt on the goal with another model or guidance; the new agent is told
  what the last attempt ran into (decision, failing checks, comments). `hive retry`, `hive_retry`.
- **Why is this line here?**: from any line of trunk to the change that wrote it, its goal, the
  agent's intent, the checks, the review and the decision. Trunk column, `hive why path:line`,
  `hive_why` (agents can ask before changing code they don't understand).
- Repositories set up for agents work as-is: `.agents/prepare` (or `.delta/prepare`) is the setup.
- **Email notifications** (`mailto:` hooks) when `HIVE_EMAIL_FROM` is set; race lanes side by side
  in the diff view.
- **Roadmap** at [hivegit.dev/docs/roadmap](https://hivegit.dev/docs/roadmap) with progress per
  item; `docs/ROADMAP.md` is generated from the same data (`pnpm roadmap`).

### Changed
- An agent that stops without submitting leaves its change waiting for a person, with the reason,
  instead of looking busy forever; restart works on it.
- Private imports send their token through the egress gateway, never into the container.
- pnpm and yarn repositories run `corepack enable` first, so package scripts that call `pnpm` or
  `yarn` work (Hive's own checks needed this).
- A change that adds nothing to trunk says so instead of asking Clef.

## [1.4.0] - 2026-10-12

Hive works with GitHub, knows what it costs, and shows the code.

### Added
- **Diff view** in the change drawer: files with counts, numbered lines, declared functions marked,
  undeclared files flagged, a Widen toggle. Diffs come from the agent's submit (or the CLI's) and
  then the merge queue's check, and are served from storage, not a container.
- **Cost tracking and budgets.** Every model call (agents, planner, reviews, Clef) and container run
  is recorded and priced. Spend shows in the top bar, per goal and per change; `hive cost`,
  `hive_costs`. Budgets per goal (covering sub-goals) and a default per repository stop agents
  before each step once reached; raise and restart to continue.
- **Model leaderboard** per repository: landed, landing rate, sent back, needed a person, median time
  to land, cost per landed change. Dashboard, `hive models --stats`, `hive_models`.
- **GitHub issues as goals**, idempotent, linked back, with `Hive-Issue` trailers on what lands.
  Open goals can be started from the goal list.
- **Push back to GitHub**: trunk mirrored to `hive/main`, a pull request per achieved goal with its
  evidence and decision (`Fixes #n` for issue goals), and optional upstream sync through the merge
  queue. The token is stored sealed and used only by the egress gateway.
- **Notifications**: webhooks for needs-you, goal landed, race finished and trunk failing; Slack and
  Discord formats, or JSON signed with HMAC-SHA256.
- **Dependency cache**: what setup installs is archived to R2 by lockfile; fresh boxes restore it
  instead of installing. `hive.json` gains `cache`.

### Changed
- Changes whose own tests passed land at a lower bar (0.70 instead of 0.85) when land is Clef's top
  choice, there are no conflicts and the agent's trust is at least 0.5.
- Plan advancement can no longer start a sub-goal twice under concurrent landings.
- Reviews give the primary model one bounded try, then fall back to gpt-oss 120B.

## [1.3.0] - 2026-10-12

Everything the dashboard does, from the terminal and from Claude Code.

### Added
- **CLI:** `hive login` (URL, token and default repo saved to `~/.config/hive/config.json`, token
  checked), `hive import`, `hive init`, `hive checks` (`--plan` to only list them), `hive settings`,
  `hive assign`, `hive race`, `hive plan`, `hive goal --plan --models …`, `hive land`,
  `hive send-back`, `hive winner`, `hive restart`, `hive abandon`, `hive clone [--ledger]`,
  `hive watch` and `hive models`. Models take short names (`kimi`, `deepseek`, `glm`, `gpt-oss`,
  `qwen`, `nemotron`). Server errors are shown as messages, not HTTP failures.
- **MCP:** `hive_assign`, `hive_race`, `hive_pick_winner`, `hive_decide`, `hive_run_checks`,
  `hive_settings`, `hive_clone`, `hive_create_repo`, `hive_restart`, `hive_abandon`.

## [1.2.1] - 2026-10-12

### Changed
- **The dashboard is read-only until you sign in.** Signed out, the goal panel explains what agents
  do and offers the waitlist; Import, Clone with git, Run checks, settings, land / send back and
  race picks ask you to sign in first instead of failing on submit.
- **A goal composer that explains itself:** One agent, Race models, Plan and split, each with what
  it does. The button says what will happen ("Start Kimi K2.7 Code", "Start a 3-model race",
  "Plan it with GLM 5.3"). If the goal is created but no agent starts, it says so.
- **Plans use several models.** Choose the planner and any number of agent models; sub-goals take
  them in turn. `agentModels` on `POST …/plan` and `hive_plan` (`agentModel` still works).

### Added
- Docs: [Goals, races & plans](https://hivegit.dev/docs/dashboard), how a change lands and how to
  read the map.

## [1.2.0] - 2026-10-12

Anyone can now find out how to use Hive, and do it: watch the public demo, run it on a laptop,
deploy their own with one command, and connect agents.

### Added
- **Docs at [hivegit.dev/docs](https://hivegit.dev/docs):** get started, the live demo, running
  locally, deploying your own, connecting agents (MCP, CLI, git), repositories and `hive.json`,
  the security scan, plans, and the API reference.
- **`pnpm self-host`** deploys your own Hive: checks Node, git, Docker and the Cloudflare login,
  creates the Artifacts namespace and queue, generates the access token, deploys, and prints the
  next steps. Safe to rerun. `HIVE_DOMAIN` serves it on your domain (DNS records added),
  `HIVE_WORKER_NAME` and `HIVE_NAMESPACE` run several Hives on one account.
- **`pnpm start`** runs Hive locally: devhost and the Worker together, after checking what's
  needed.
- **The `hive` CLI as a download:** `curl -fsSL https://hivegit.dev/install.sh | sh` installs a
  checksum-verified release build for macOS or Linux (arm64 and x86_64). Releases build them in
  GitHub Actions; `cargo install --git https://github.com/hivegithq/hive hive-cli` also works.
- Landing page: a **Get started** section (the three paths, the MCP command, the CLI installer)
  replaces the import form, and live totals for the whole deployment (`GET /api/hive/stats`).
- Dashboard: a checks badge in the top bar, and the last trunk check run in Checks & settings.
- CI: typecheck, Worker tests and `cargo test` on every push and pull request.

### Changed
- **Sign-in with a waitlist on hivegit.dev.** Visitors join the waitlist (Clerk); people let in sign
  in and make changes from the dashboard, with no token to paste. The Worker verifies Clerk session
  tokens against the instance's public keys, so no Clerk secret is involved. A change attempted
  while signed out explains why and offers the waitlist. `HIVE_CLERK_PUBLISHABLE_KEY` turns this
  on for any deployment; without it, the owner pastes `HIVE_TOKEN` once, in a dialog rather than
  a bare browser prompt.
- **MCP reads are public:** `initialize`, `tools/list`, `hive_status`, `hive_symbols` and
  `hive_change` work without the token, as REST reads always have. Other tools answer with how to
  get write access.
- **Trunk pushes made outside Hive are noticed without setup:** the coordinator's heartbeat
  compares trunk's head with the last one it saw, so the per-repository Artifacts → Queue
  subscription is now optional (it only makes that instant).
- The Worker's routes, name and namespace come from the environment, so the repository deploys
  anywhere without edits.
- Hive lives at **hivegit.dev** (the workers.dev address keeps working).

## [1.1.0] - 2026-10-11

Hive works on any codebase: bring a repository in from GitHub, check it in its own language,
gate on security, and let a planner spread big goals across many agents.

### Added
- **Evidence in any language.** `hive.json` declares a repository's setup and checks; without one,
  Hive detects Node, Rust (`cargo`), Python (`pytest`) and Go. The sandbox image now carries those
  toolchains, and containers may reach their package registries. Agents get a `run_checks` tool
  that runs exactly what the merge queue runs; `POST /api/repos/:repo/checks` runs it on trunk.
- **Security evidence.** gitleaks, osv-scanner and Semgrep, compared with trunk: a change fails on
  findings it introduces, existing findings don't block anyone, and resolved ones are reported.
  On with `"security": true` in `hive.json` or the `security` repository setting.
- **Import from GitHub** (or any https git server): `POST /api/repos/import`, the landing page's
  form, and `hive_import` over MCP. The default branch becomes `main`; a private repository's token
  is used for one clone and never stored.
- **Plans.** A planner model explores trunk (files, the code graph) and splits a big goal into
  sub-goals with dependencies; Hive starts agents on them as dependencies land, up to a
  parallelism limit. `POST /api/repos/:repo/goals/:goal/plan`, **Plan it first** in the dashboard,
  `hive_plan` over MCP.
- A demo repository with planted vulnerabilities (`SEED=seed-vuln node demo/seed.ts`).
- Dashboard: a live **plan graph** (the planner's progress, then each sub-goal by status; click one
  to open its change), a **Checks & settings** panel (what Hive runs, a run on trunk, the security
  scan, decider and batch size), security results as introduced, resolved and unchanged findings,
  and **Import** in the top bar.
- Landing page: "Bring any codebase", "Security is evidence too" and "One big goal, many agents",
  with the security run's plan and findings read live.

### Verified
- `dtolnay/itoa` (Rust), `pypa/sampleproject` (Python) and `google/uuid` (Go) imported from
  GitHub with their checks passing on trunk; a Kimi agent's Rust change landed on `cargo test`.
- One goal on a service with six planted vulnerabilities: GLM 5.3 planned seven sub-goals
  (including a SQL injection no scanner flagged), Kimi agents fixed them in parallel, and all 9
  scanner findings were resolved with none introduced and 18 of 18 tests passing.

### Changed
- Agent containers keep dependency and build directories out of commits.
- File tools and intents take paths relative to the repository root; a workspace prefix is
  stripped and paths outside the repository are refused.
- A page open across a deploy reloads once instead of failing to load its route.
- Git traffic to allowed hosts gets the same buffered, uncompressed handling as Artifacts traffic.

## [1.0.0] - 2026-10-11

The first release: version control for many AI agents working on one repository at once, running
entirely on Cloudflare.

### Version control for agents
- **Goals** replace issues and pull requests; each **change** gets its own Artifacts repository
  (a fork), with a stable `Hive-Change-Id` that survives rebases.
- **Intents**: agents declare the files and symbols they'll change before writing code. Every intent
  is checked against every live intent through a tree-sitter code graph, at three levels: textual,
  structural and referential (a change to something another change calls).
- **Batch landing**: up to 128 changes are stacked on trunk with mergiraf as the merge driver and
  verified once. A failing batch checks trunk on its own, then splits until culprits are isolated;
  every good change in the batch still lands. Purely additive conflicts keep both sides. Two
  batches pipeline under a trunk lease, and the exact verified commit is what's pushed.
- **Decisions**: tests, typecheck and build are evidence; a review model writes an opinion; Clef
  returns calibrated probabilities to land, send back or ask a person. Or land on evidence alone.
- **Races**: several models attempt one goal in parallel forks; Clef picks the winner.
- **Ledger**: trailers on every landed commit, and goals, intents, evidence, reviews, decisions and
  agent transcripts committed to a companion repository.

### Ways in
- Built-in coding agents on Workers AI (Kimi K2.7 Code, GLM 5.3, DeepSeek V4 Pro, free models).
- An MCP server for Claude Code, Codex and any MCP client; the `hive` CLI in Rust; plain git.
- A landing page and live dashboard built on Kumo, Cloudflare's design system: a live hive, an
  interactive batch demo running the production search code, and a Hive map of every change.

### Verified
- 2,000 simulated agents on one repository: 1,987 landed at 125 a minute; the 13 escalations were
  exactly the agents broken on purpose; trunk checked with a stock `git clone`.
- A six-agent, three-model swarm and a three-model race on a real codebase, landed by Clef.

### Known limits
- Evidence runs the `typecheck`, `test` and `build` scripts of a Node `package.json`; other
  languages get no evidence yet.
- Repositories are created empty or pushed with git; there's no import from GitHub yet.
- Large goals aren't decomposed automatically: a goal goes to one agent or a race.

[1.8.0]: https://github.com/hivegithq/hive/releases/tag/v1.8.0
[1.7.0]: https://github.com/hivegithq/hive/releases/tag/v1.7.0
[1.6.0]: https://github.com/hivegithq/hive/releases/tag/v1.6.0
[1.5.0]: https://github.com/hivegithq/hive/releases/tag/v1.5.0
[1.4.0]: https://github.com/hivegithq/hive/releases/tag/v1.4.0
[1.3.0]: https://github.com/hivegithq/hive/releases/tag/v1.3.0
[1.2.1]: https://github.com/hivegithq/hive/releases/tag/v1.2.1
[1.2.0]: https://github.com/hivegithq/hive/releases/tag/v1.2.0
[1.1.0]: https://github.com/hivegithq/hive/releases/tag/v1.1.0
[1.0.0]: https://github.com/hivegithq/hive/releases/tag/v1.0.0
