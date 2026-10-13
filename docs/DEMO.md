# Demo script (about 9 minutes)

Setup before recording: either the live site (<https://hivegit.dev>, owner token for the writes) or
local (`pnpm start`, `node demo/seed.ts`, dashboard at `/r/shop`). Have a terminal with
`node tools/watch.ts shop` and a second terminal in an empty folder.

## What the judges score

The rules weigh originality and quality of the prototype for agent-oriented collaboration at 50%;
multi-agent concurrency, coordination, context preservation, review and conflict handling at 25%;
and ease of use and experience at 25%. Where each section of this script lands:

- **Originality (50%):** sections 1, 2 and 8 (intents before code, the ledger in git, Hive building Hive).
- **Concurrency, coordination, context, review, conflicts (25%):** sections 2 to 7 (the swarm, the
  convergence queue, races, 2,000 agents, reviewing and rewinding, conflicts merged in the queue).
- **Ease of use (25%):** section 5 (any agent, any client) and the dashboard throughout.

## 1. The problem (0:00–0:45)

Over the dashboard, empty: "Git was built for a handful of people who coordinate in meetings and
PR threads. Agents can't do that. Put fifty of them on one repo and you need to know, before they
write code, who is touching what. You need merges that understand code, and a record of why
every change landed. That's Hive."

## 2. A swarm, live (0:45–3:00)

Run `node demo/swarm.ts`. Six strips appear in **Working**.

- Click a strip: each agent has **its own Artifacts repo**, forked from trunk.
- As intents arrive, notches appear on the strips. Point at the **structural** pair (two agents
  in `checkout()`) and the **referential** one (an agent changing `parsePrice` while another
  edits code that calls it). "Hive saw these before any code was written. Clef rated the
  severity and told one agent to narrow its scope."
- The README goal moves to **In queue** first: disjoint changes land first.

## 3. Convergence (3:00–5:00)

Open a strip in **Converging**: rebase with mergiraf, typecheck, tests, review, then the Clef
decision with its probabilities. "Tests are evidence. The review is an opinion, and it's labeled
as one. The decision is calibrated: 93% land, so it lands."

Show a **bounce**: the agent gets the failing test output and conflict excerpt, fixes it, and its
attempt counter goes to 2.

Terminal: the `hive-merge referential` moment. `git merge` succeeds; Hive flags that
`checkout` calls a `price` whose contract changed.

## 4. A race (5:00–6:15)

`node demo/race.ts`: Kimi, GLM and DeepSeek attack the same goal in three forks. When all
three finish, Clef judges them side by side; one strip says **won race**, the others are
archived. "Best-of-N is a version-control primitive here, not a prompt trick."

## 5. Any agent, any client (6:15–7:15)

- `claude mcp add --transport http hive http://localhost:5173/mcp`, and Claude Code claims a goal.
- `hive claim … && hive intent --from-diff`: the Rust CLI uses the same tree-sitter index to declare
  exactly the symbols your diff changed.
- "Clone with git": trunk is real git; any client works.

## 6. Two thousand agents (7:15–8:00)

Before recording, start a load test on a fresh repo (deployed, `decider: "evidence"`,
`batchMax: 128`; see the README's "Load test it yourself"), and record its dashboard from the
start. Speed it up in the edit.

- The strip board fills: thousands of agents, each with its own fork, landing in batches of up
  to 128. `node tools/stats.ts` beside it: about 125 landings a minute on one repository.
- Point at the escalations: exactly the agents that were broken on purpose. "A batch that fails
  gets split until the culprit is found; everyone else in the batch still lands."
- `git clone` the trunk: one commit per landed change, every one with its `Hive-Change-Id`, and
  the tests pass. "It's still just git."

## 7. Working with the agents (8:00–8:45)

Open a landed or waiting change on any repository.

- **Review comments:** click a line in the diff, write what's wrong, send it back; the agent reads
  it before its next step.
- **Why is this line here?** Pick a line: the change, goal, intent, proof and decision behind it.
- **Rewind:** carry on from step N of an attempt with its edits redone, or try again on another
  model (any model on an OpenAI-compatible endpoint works too: bring your own key).
- **History by goal** shows every attempt, how it ended, the pull request and the cost.

## 8. The record, and Hive builds Hive (8:45–9:30)

`git clone` the `shop.hive` ledger repo: goals, intents, evidence, reviews, decisions, full agent
transcripts, as JSON in git. "Years from now, `git log` tells you what changed, and the ledger
tells you why and who decided."

Then show hivegit.dev/r/hive: Hive imported its own repository, passed its own checks and opened
hivegithq/hive#1 through the GitHub integration. "It builds itself, with the same evidence."

Close on the architecture slide: Workers, Durable Objects, Agents SDK, Workflows, Containers,
Artifacts, Workers AI and Clef.
