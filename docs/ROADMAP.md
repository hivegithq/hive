# Roadmap: Hive builds Hive

The next round of Hive is built by Hive. We import this repository into hivegit.dev, turn the
roadmap below into goals, and let agents work on them in parallel. Every change is gated by
Hive's own checks (typecheck, vitest, `cargo test`) and decided by Clef. We review what lands,
bring it back to GitHub, and deploy it ourselves.

It is the best demo Hive can give: a real codebase with real tests, improving the system that
runs it, with every intent, evidence run and decision on the dashboard.

## Where these come from

Everything here was hit for real while running Hive on imported projects (`itoa`,
`sampleproject`, `uuid`) and while dogfooding the CLI and MCP:

- On `uuid`, changes whose checks all passed ended up under **Needs you**. The review model timed
  out, so Clef wasn't confident enough to land them alone.
- Restarted agents opened **duplicate changes**: `uuid` has three copies of `version7_test.go`.
- Imported repositories **drift from GitHub**: fixes land on Hive's trunk and stay there.
- We can't say what a run **cost**. Agent token usage isn't recorded anywhere.
- Every merge box reinstalls dependencies from scratch, so **each batch pays for setup again**.
- Watching for changes that need a person means **keeping the dashboard open**.
- In the change drawer you see evidence and a review, but **not the code**.

## The list

**Status:** "Do now" = item 1, done by hand before the run. **In scope** = items 2–9, built by Hive. **Later** = items 10–13.

| # | Item | Status | Size | How it runs in Hive |
|---|---|---|---|---|
| 1 | Review timeouts don't cause escalation | Do now (by hand) | S | — |
| 2 | No duplicate changes on restart | In scope | S | One agent |
| 3 | Dependency cache between merge boxes | In scope | M | One agent |
| 4 | Push back to GitHub (mirror trunk, PR per goal, pull upstream) | In scope | L | **Plan and split** |
| 5 | GitHub issues → goals | In scope | M | One agent |
| 6 | Cost tracking and budgets | In scope | M–L | **Plan and split** |
| 7 | Model leaderboard per repo | In scope | S–M | **Race** (showcase) |
| 8 | Notifications when something needs you | In scope | M | One agent |
| 9 | Diff view in the change drawer | In scope | S–M | **Race** (showcase) |
| 10 | "Your repos" home page | Later | M | |
| 11 | Personal API keys / MCP OAuth, per-user spend limits | Later (when the waitlist opens) | L | |
| 12 | Recurring goals (nightly lint, weekly dependency updates) | Later | M | |
| 13 | Lazy-load Clerk (~145 KB on every page) | Later | S | |

### 1. Review timeouts don't cause escalation (by hand, first)
The landing review calls a model; when it times out, Clef sees no review and its confidence drops
just under the landing bar. Retry once, then fall back to a second model, then decide on evidence
alone (as `decider: "evidence"` does) and record that the review was skipped.

**Done when** a change whose checks pass lands even if every review model times out, and its
decision says so.

### 2. No duplicate changes on restart
A restarted or re-assigned agent must continue its change, not open a new one. And two changes
on one goal declaring the same files should be reconciled (one archived, recorded as superseded).

**Done when** restarting an agent mid-run leaves exactly one live change per goal. A test covers
restart and re-assign in the coordinator.

### 3. Dependency cache between merge boxes
Setup commands (`npm ci`, `pnpm install`, `cargo fetch`, `go mod download`, the Python venv)
are keyed by a hash of the files they depend on. Hive already re-runs setup only when those files
change *within* a box. Persist the result *across* boxes:
- a tarball in R2, keyed by repo + setup command + lockfile hash;
- restored before setup, saved after a successful one;
- bounded in size, evicted per repo.

**Done when** the second batch after an import skips the install (a timing shown in the
evidence), and a lockfile change invalidates it. Tests cover key derivation and invalidation.

### 4. Push back to GitHub (planned goal)
Imported repositories remember where they came from. Three parts, which the planner should split
further:
- **Mirror:** push trunk to a branch on the origin (e.g. `hive/main`) after each landing batch.
- **PRs:** open one pull request per landed goal, with the goal, the evidence and Clef's decision
  in the body.
- **Pull upstream:** fetch new commits from origin's default branch on a schedule and fast-forward
  or rebase trunk, so outside work reaches the agents.

Credentials: a GitHub token per repository (fine-grained, contents + pull requests). It's stored
encrypted and set from the dashboard or `hive github connect`, and never enters a container
(pushes go through the outbound gateway, like Artifacts tokens do).

**Done when** a landed goal on a test repo shows up as a PR on GitHub, and a commit pushed to
GitHub appears on Hive's trunk within the polling interval.

### 5. GitHub issues → goals
`hive issues import owner/repo [--label x] [--exclude-label upstream] [--limit n]`, the same in
MCP (`hive_import_issues`), and a dashboard button.
- One goal per issue: title, body, a link back, and `Hive-Issue: owner/repo#123` on the landed
  commit.
- Re-running skips issues already imported.

With #4, the PR body says `Fixes #123`.

**Done when** importing a repository's issues creates one goal each, idempotently, and a landed
fix carries the issue trailer.

### 6. Cost tracking and budgets (planned goal)
Record usage for every model call: agents, reviews, planner, Clef, judges.
- **What:** tokens in and out, the model, and the change, goal and agent it was for.
- **Price:** from a per-model price table (Workers AI's published prices).
- **Where it shows:**
  - per change (drawer), per goal and per repo (dashboard), per model (feeds #7);
  - `hive cost`;
  - in the ledger.
- **Budgets:** a cap per goal and per repo. An agent that hits it stops with a clear reason, and
  the goal waits for a person.
- **Container time:** box seconds and instance type, so a run's full cost is visible.

**Done when** every change shows its cost, a goal with a $1 budget stops its agents at $1, and
totals match the sum of the recorded calls. Tests cover the accounting and the budget stop.

### 7. Model leaderboard per repo (race)
From data Hive already has, per model:
- changes started and landed, landing rate, and how often changes were sent back or escalated;
- median time to land;
- cost per landed change (with #6).

A panel on the dashboard, `hive models --stats`, and the landing page's live totals for hivegit.dev.

**Done when** the leaderboard for `uuid` matches its changes and decisions.

### 8. Notifications
When a change needs a person, a race finishes, a plan completes, or trunk's checks start failing:
- **Webhook first** (JSON, signed), which covers Slack/Discord through their incoming webhooks.
- **Email** through Cloudflare Email Service to the repo owner.
- Per-repo settings choose events and destinations.
- Delivery is retried, with failures recorded.

**Done when** escalating a change on a test repo posts to a webhook receiver with a valid
signature. Tests cover signing and the event filter.

### 9. Diff view in the change drawer (race)
The change's diff against its base (from Artifacts), file by file:
- additions and deletions;
- the declared intent's symbols highlighted;
- syntax colouring for the common languages;
- large diffs collapsed.

For a race, the candidates can be compared side by side.

**Done when** any landed or open change shows its diff, and a race's candidates can be compared.

## How the run works

1. **By hand, first:** item 1, plus a `hive.json` for this repository:

   ```json
   {
     "setup": ["corepack enable", "pnpm install --frozen-lockfile"],
     "checks": {
       "typecheck": "cd apps/worker && npx cf workers types && npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.web.json",
       "test": "cd apps/worker && npx vitest run",
       "rust": "cargo test --locked"
     }
   }
   ```

2. **Import** `hivegithq/hive` into hivegit.dev as `hive`, and run `hive checks` until trunk is
   green.
3. **Goals:**
   - one goal per item, from this document, with its "Done when" as acceptance criteria;
   - #4 and #6 are **planned** (GLM 5.3 plans; Kimi and DeepSeek take sub-goals in turn);
   - #7 and #9 are **races** between Kimi, DeepSeek and gpt-oss, the showcase moments;
   - the rest get one agent (Kimi);
   - 4–6 agents at once.
4. **Watch** with `hive watch hive`, and decide anything under Needs you with
   `hive land` / `hive send-back`.
5. **Bring it home:** review the landed changes, pull Hive's trunk into GitHub (by hand until #4
   exists, then #4 does it), and deploy when no agent is mid-edit.

Agents' changes never deploy by themselves. Anything needing a secret (a GitHub token, a webhook
URL) is code the agents write and configuration we add.

## What it costs

### Measured
From the `uuid` run, five Kimi K2.7 agents that each landed a change, measured from their
transcripts:
- 7–18 turns per agent;
- **~150k input and ~5k output tokens per agent** on average (77k–267k input);
- **≈ $0.16 per agent** at Kimi's price.

Those were small tasks (one test file each) in a small Go repository.

### Workers AI prices (per million tokens)

| Model | Input | Output | Used for |
|---|---|---|---|
| Kimi K2.7 Code | $0.95 | $4.00 | Agents |
| DeepSeek V4 Pro | $1.32 | $3.96 | Agents, reviews |
| GLM 5.3 | $1.40 | $4.40 | Planner |
| gpt-oss 120B | $0.35 | $0.75 | Cheap agents (weaker) |
| Clef Flash | $0.038 | — | Decisions |

### Estimate for items 2–9
Work on Hive is bigger than a `uuid` test file: several files, a TypeScript and Rust codebase,
UI plus backend. Assume **4–10× the measured usage per attempt**, i.e. 0.6–1.5M input and
20–50k output, and about 1.5 attempts per change to cover changes sent back.

| Part | Agent runs | Model cost |
|---|---|---|
| #2, #3, #5, #8: one agent each | ~6 attempts | $6–15 |
| #4 and #6, planned (~5 sub-goals each, plus planning) | ~15 attempts + 2 plans | $17–40 |
| #7 and #9, three-model races | ~9 attempts | $8–20 |
| Reviews (DeepSeek) and Clef, per change | ~30 changes | $1–3 |
| **Total models** | | **~$30–80** |

**Containers:**
- agent boxes (standard-1) cost about $0.07 an hour each;
- a merge box (standard-4) about $0.40 an hour, and a batch runs ~5 minutes;
- total: **under $5**, most of it inside Workers Paid's included container time.

**All in: roughly $35–85**, likely toward the lower end because most items are small.

**Time:** with 4–6 agents at once, each change takes 15–40 minutes to reach trunk. Expect the
whole run to take **an afternoon**. Reviewing and deploying is on us.

### Keeping it cheap
- **Kimi by default.** It's the cheapest of the strong models; use races only where the
  comparison is the point.
- **Measure first.** Run #2 alone, check its real usage against the estimate, then start the
  rest.
- **Small goals.** Tight "Done when" criteria keep agents from wandering, and wandering is where
  the tokens go.
- **Once #6 lands,** give every later goal a budget.
- **gpt-oss 120B** is about 3× cheaper. It's fine for #2 and #7, but weaker on the multi-file
  items.

## Risks

- **Deploys interrupt agents.** Don't deploy hivegit.dev while the run is going: containers
  restart and planners stop.
- **Checks only prove what they test.** #3, #4 and #8 touch external systems (R2, GitHub, email).
  Agents can unit-test the logic; the end-to-end check is ours, against a test repository and a
  test webhook.
- **Secrets stay with us.** No token for GitHub, email or webhooks goes to an agent. They write
  the code paths; we configure them.
- **Overlap is expected.** #6 and #7 both touch usage data, and #4 and #5 both touch GitHub.
  Declared intents surface that early, which is part of the demo.
