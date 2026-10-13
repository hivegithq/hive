# Roadmap

What Hive does next, and how far along each piece is. Also at <https://hivegit.dev/docs/roadmap>.
Ideas marked "from Delta" come from [delta.dev](https://delta.dev), the Zed team's multiplayer
environment for coding with agents. Generated from `apps/worker/src/web/docs/roadmap.ts` by
`pnpm roadmap`: edit that file, not this one.

## Next

| Item | Progress | |
|---|---|---|
| **Conversation branching: retry from step N** (from Delta) | `████░░░░░░` 40% | Rewind an agent to an earlier step, with its workspace as it was then, and continue differently; keep both branches to compare. *Today:* Try again starts a fresh attempt that knows what the last one ran into. Transcripts are kept per step. |
| **A reviewer that fixes** (from Delta) | `██░░░░░░░░` 15% | A review agent works on a copy of the change and pushes fixes (with Approve / Request changes), instead of only writing a review. *Today:* A model review and Clef's decision on every change; review comments from people. |
| **Agent roles in plans: scouts, workers, reviewers** (from Delta) | `██░░░░░░░░` 20% | Planned goals use cheap read-only scouts to explore, workers to write, and reviewers to check, each with its own model. *Today:* The planner and parallel workers, with models per plan. |
| **Provenance graph** (from Delta) | `███░░░░░░░` 30% | One view of how the repository evolved: goals, plans, agents' attempts, landings, pull requests, with the conversations behind them. *Today:* Why-is-this-line-here, the plan graph, trunk history with trailers, the ledger. |
| **Agents talking across work** (from Delta) | `████░░░░░░` 40% | Agent-to-agent messages visible in the dashboard, and plans that route questions to the agent that owns the code (“ask whoever holds Cart.total”). *Today:* hive_message and agent inboxes; intents say who is touching which symbols. |
| **Steer a working agent live** (from Delta) | `███░░░░░░░` 30% | Join an agent while it works: watch its steps stream, send a correction mid-run, pause or stop it. *Today:* Comments reach a working agent's inbox; the activity ticker; restart and abandon. |
| **Review progress: files seen** (from Delta) | `░░░░░░░░░░` 0% | Mark files seen while reviewing a change, cleared when the agent edits them again (3/17 reviewed). |
| **Bring your own model provider** (from Delta) | `░░░░░░░░░░` 0% | Agents on Anthropic, OpenAI or any compatible API (through AI Gateway), next to Workers AI, with spend tracked the same way. |
| **Context window breakdown** (from Delta) | `██░░░░░░░░` 20% | Per agent step: how much went to the system prompt, history, tool output; where the tokens (and money) go. *Today:* Tokens and cost per call and per change. |
| **Watchers, mentions and read-only sharing** (from Delta) | `█░░░░░░░░░` 10% | Follow a repository or change, @mention a teammate on a change that needs them, share read-only links. *Today:* Public read-only dashboards; sign-in with a waitlist; webhooks. |
| **Repository-level memory** (from Delta) | `██░░░░░░░░` 15% | Comments, decisions and lessons from earlier changes offered to new agents working on the same code. *Today:* The ledger records every intent, review and decision; try again carries one attempt's lessons forward. |
| **“Your repos” home page** | `░░░░░░░░░░` 0% | A signed-in home listing your repositories, what needs you, and spend. |
| **Personal API keys and MCP sign-in** | `█░░░░░░░░░` 10% | People let in from the waitlist use the CLI and MCP with their own keys and spend limits, not the owner's token. *Today:* Clerk sign-in for the dashboard; budgets per goal. |
| **Recurring goals** | `░░░░░░░░░░` 0% | Goals that run on a schedule: nightly “fix new lint warnings”, weekly “update dependencies”. |
| **Lazy-load sign-in** | `░░░░░░░░░░` 0% | Load Clerk only when someone signs in, instead of 145 KB on every page. |

## Shipped

| | Version |
|---|---|
| Review comments on the diff, sent to the agent (from Delta) | 1.5.0 |
| Try again with another model or guidance, told what the last attempt ran into (from Delta) | 1.5.0 |
| Why is this line here? (line → change, goal, intent, proof, decision) (from Delta) | 1.5.0 |
| .agents/prepare and .delta/prepare as setup (from Delta) | 1.5.0 |
| Agents that give up wait for a person instead of looking busy | 1.5.0 |
| Email notifications; side-by-side race lanes; private imports through the gateway | 1.5.0 |
| Diff view in the change drawer | 1.4.0 |
| Cost tracking and budgets | 1.4.0 |
| Model leaderboard per repository | 1.4.0 |
| GitHub issues as goals | 1.4.0 |
| Push back to GitHub: mirror, a pull request per goal, upstream sync | 1.4.0 |
| Webhooks: Slack, Discord, signed JSON | 1.4.0 |
| Dependency cache shared between boxes | 1.4.0 |
| Tested changes land at a lower bar; no duplicate sub-goals | 1.4.0 |

## How Hive is built

Items are built by hand or, for a showcase, by Hive itself on a free-tier Workers AI model, gated
by Hive's own checks (typecheck, vitest, `cargo test`). The plan and the measured costs are in
[Hive builds Hive](HIVE-BUILDS-HIVE.md); what shipped when is in the [changelog](../CHANGELOG.md).
