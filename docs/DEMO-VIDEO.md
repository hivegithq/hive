# Demo video: script and storyboard

Length 5:19, 16:9, 1080p30, for the Cloudflare competition (5 to 10 minutes). One voice, calm and
precise, no hype: about 700 words, generated locally with Kokoro (`af_heart`). Animated diagrams
explain each mechanism, real hivegit.dev screens prove it, and every number comes from the live
deployment or the README's verified table. Captions are burned in.

Rendered file: `video/hive-demo/renders/hive-demo-final.mp4` (-14 LUFS).

## What the video has to do

The judges score three things, so each scene is built to carry one:

| Weight | What they score | Scenes |
|---|---|---|
| 50% | Originality and quality of the prototype for agent-oriented collaboration | 1, 3, 9, 10, 11 |
| 25% | Multi-agent concurrency, coordination, context preservation, review, conflict handling | 4, 5, 6, 8 |
| 25% | Ease of use and experience | 7, 9, and the dashboard throughout |

## The motif: bees

Hive is a hive. Every agent is a **bee**, every change is a **cell**, and trunk is the **comb**
filling with honey. It matches the product: the dashboard draws every repository as a honeycomb.

- The bees are drawn in code on a canvas, seeded so every frame is the same on every render.
- A bee docking into a cell is a change landing: the cell flashes and fills honey, with a tick.
- A cell that flashes alarm red and stays empty is "needs a person", with a low tone.
- Between scenes, one bee crosses the frame and its trail wipes to the next scene.
- The swarm opens the film and returns at full scale for the 2,000-agent run.

## Rules for the look and the sound

- **Real product, never redrawn.** Product shots are high-resolution screenshots of hivegit.dev
  under slow camera moves, with honey outlines on the part that matters. Diagrams explain the
  mechanism; the screens prove it.
- **Palette:** night `#0d0d0f`, honey `#fbad41` as the one accent, flare `#f6821f` for work in
  progress, steel `#7d8da1`, alarm `#f0605d` only for "needs a person". Wax `#fff4e0` for text.
- **Type:** Chakra Petch for titles, JetBrains Mono for anything typed, Inter for body text.
- **Plates:** two generated backgrounds (DreamLayer): `hive-plate.jpg` (hexagons streaming into a
  bright trunk) and `problem-plate.jpg` (lines fanning out, red sparks where they collide).
- **Sound:** a low hum bed under the voice, a buzzing swarm in scenes 1 and 10, a tick on every
  landing, a low tone on every "needs a person", a whoosh on every bee transition.

## Storyboard and script

Times are from the start of the video. **VO** is the narration, word for word. **Screen** is what
is on screen. **Source** is where the picture comes from.

### 1. Cold open: the hook and what's coming (0:00 to 0:27)

- **Screen:**
  - 0:01 One bee flies in over the hive plate and docks in the centre of an empty honeycomb. Tick.
  - 0:02 Then a swarm: hundreds of bees stream in from the edges and the comb fills cell by cell.
    Big type lands on the left, one line per beat: **2,000 agents.** / **1 repository.** /
    **17 minutes.** / **Nobody touched anything.** (in red)
  - 0:06 Thirteen cells flash red and stay empty. The comb slides to the centre.
  - 0:07 Match cut: the comb becomes the real 2,000-agent dashboard, whose map is the same honeycomb.
    The camera pulls back from the hex to the whole page.
  - 0:09 Title over the dimmed dashboard: the Hive mark, **Hive**, "Version control built for
    agents. **On Cloudflare.**"
  - 0:12 **What you'll see**, `01 / 04` to `04 / 04`, a bee wiping in each real screen:
    1. "Agents announce what they'll change, before code." The intent and symbols of a real change.
    2. "A queue that tests, then decides." The real evidence and Clef's decision, land 94%.
    3. "Models race on the same goal." The real history graph: three models, one landed.
    4. "Every decision kept in git." Trunk, with each line linked to the change behind it.
  - 0:24 **Here's how it works.**
- **Source:** coded swarm over `hive-plate.jpg`; screenshots of `scale2k`, `demo-shop` change
  `c-74109676f8`, the demo-shop history graph, and camelcheck's trunk panel.
- **VO:** "Two thousand AI agents. One repository. Seventeen minutes. Nobody touching anything.
  This is Hive: version control built for agents, on Cloudflare. In the next five minutes you'll
  see agents announce what they'll change before they write a line, a queue that tests every
  change and decides what lands, models racing each other on the same goal, and every decision
  kept in git. Here's how it works."

### 2. The problem (0:27 to 0:48)

- **Screen:** the problem plate, mirrored so the collisions sit on the right, drifts slowly.
  **The problem**: "Branches and pull requests assume people who talk to each other."
  **Agents don't.** (in red). Then four questions, each with a red hexagon, and a red spark
  glowing on the plate as each one lands:
  1. "Who is touching what, right now?"
  2. "Will two changes break each other, even on different lines?"
  3. "Should this one land?"
  4. "Why is the code like this?"
- **Source:** plate; typography.
- **VO:** "Branches and pull requests were built for a few people who talk to each other. Agents
  don't. Put fifty of them on one codebase and four questions go unanswered. Who is touching what,
  right now? Will two changes break each other, even on different lines? Should this one land?
  And why is the code like this?"

### 3. What Hive is (0:48 to 1:18)

- **Screen:** **How Hive works: the life of a change.** A honey line draws left to right and a
  token travels along it, lighting six hexagon steps in time with the voice. Each step has a
  one-line job and the Cloudflare product that runs it:
  1. **Goal**: a person or an agent describes an outcome. *Dashboard · MCP · CLI*
  2. **Fork**: every change gets its own repository. *Artifacts*
  3. **Intent**: files and functions, declared before code. *Durable Objects*
  4. **Merge queue**: rebase, typecheck, test, review. *Workflows · Containers*
  5. **Clef**: calibrated, land, bounce, or ask a person. *Workers AI*
  6. **Trunk**: plain git, every commit linked to why. *Artifacts*

  Then a bar underneath: **Committed to git, next to the code**: intents, evidence, reviews,
  decisions + probabilities, agent transcripts.
- **Source:** animated diagram.
- **VO:** "Hive answers all four. Every change gets its own fork, a real Artifacts repository.
  Agents declare the files and functions they'll change before they write code. A merge queue
  rebases, tests and reviews each change, and lands it only when a calibrated model is sure. And the whole
  record, the intents, the evidence and the decisions, is committed to git, next to the code."

### 4. A swarm, live (1:18 to 2:08)

- **Screen:**
  - **A real run · demo-shop**: seven goals, three models, each change in its own Artifacts
    fork. Seven lanes fork up from a honey trunk line, each with its goal, its model and, as
    intents arrive, the symbols it will touch:
    Free shipping on orders over $50 (Kimi K2.7 Code) `checkout()`;
    Percentage discount codes (GLM 5.3) `checkout() · applyDiscount`;
    Cart quantities (DeepSeek V4 Pro) `Cart.add · Cart.setQuantity`;
    Format prices with thousands separators (Kimi K2.7 Code) `formatPrice`;
    Accept euro-style decimals in parsePrice (GLM 5.3) `parsePrice (new contract)`;
    Document the public API (DeepSeek V4 Pro) `README examples → parsePrice`;
    Buy-two-get-one-free promotion (a race between three models) `promotionSavings · Receipt`.
  - 1:28 The two `checkout()` chips turn red, joined by a red arc: **Structural overlap: same
    function, caught before code.**
  - 1:33 A dashed arc joins the parsePrice lanes: **Referential overlap: parsePrice changes what
    it returns while another change uses it.**
  - 1:38 A card: "line-based merge: No conflict. **Ships a bug.**" Then: "code graph → Clef, the
    decision model: **Narrow your scope.**"
  - 1:48 Six lanes turn honey and drop a cell onto trunk, a tick each. The Percentage discount
    lane turns red: **needs a person**.
  - 1:56 The real dashboard: the honeycomb outlined, "6 landed · 1 needs a person". The camera
    moves to the models table: landing rate and cost per landed change for GLM 5.3, DeepSeek V4
    Pro and Kimi K2.7 Code.
  - 2:02 The real drawer of the held change, outlined in red: "Clef would land (0.88), but 2
    referential conflict(s) couple this change to code trunk changed meanwhile. A person should
    confirm."
- **Source:** animated diagram of the overlaps `demo/swarm.ts` is built to produce; screenshots of
  `hivegit.dev/r/demo-shop` and change `c-3ed0c71ada`.
- **VO:** "Here's a real run: seven goals, three different models, all started at once, each in its
  own fork. As they declare intent, Hive compares them. Two are about to change the same function, and that's
  caught before any code exists. A third changes what a function returns while another edits code
  that calls it. A line-based merge would accept that and ship a bug. Hive's code graph sees it,
  and Clef, the decision model, tells the agent to narrow its scope. Disjoint changes land first.
  And one change that couples to code trunk changed meanwhile is held
  for a person to confirm."

### 5. Convergence: evidence, opinion, decision (2:08 to 2:50)

- **Screen:**
  - **The merge queue: Evidence, opinion, decision.** On the left, the steps appear as the voice
    names them: merge (structural merge with mergiraf), typecheck, test, review ("85/100 · an
    opinion, not a test result"), then Clef with three bars filling: land 94%, bounce 4%,
    escalate 3%. Then **Landed on trunk.** and, in red, **Not sure? A person decides.**
  - On the right, the real drawer of the race winner (GLM 5.3), with each part outlined as it is
    named: the evidence rows, the review, then Clef's decision, land=0.94.
  - 2:29 **Same line, two agents: A model merges the conflict inside the queue.** The real drawer of
    camelcheck `c-038e2a6fdd`: "conflicts merged by @cf/deepseek-ai/deepseek-v4-pro" outlined, then
    Clef land 0.90. It landed on its first attempt.
  - 2:36 **Security is evidence too.** vulnshop: **0** introduced, **9** resolved. gitleaks for
    secrets, osv-scanner for dependencies, Semgrep for risky code; a finding the change adds fails
    it, exactly like a failing test.
- **Source:** screenshots of demo-shop change `c-74109676f8` and camelcheck change `c-038e2a6fdd`
  (drawer widened); vulnshop figures from the hivegit.dev landing page.
- **VO:** "Every change goes through the same line. A structural merge that understands code.
  Typecheck and tests. Then a model's review, labelled as an opinion, because tests are evidence
  and a review is not. Then Clef gives a calibrated probability: ninety-four percent land, so it
  lands. When it isn't sure, a person decides. And when two agents edit the same line, a model can
  merge them in the queue, and the tests still decide. Security is evidence too: turn it on, and
  every batch also runs secret, dependency and code scanners, and a new finding fails the change,
  just like a failing test."

### 6. A race (2:50 to 3:11)

- **Screen:** **A race · "Buy-two-get-one-free promotion": Three models. Three forks. One
  lands.** Three lanes, Kimi K2.7 Code, GLM 5.3 and DeepSeek V4 Pro, each its own fork, fill
  together; all three show **tests passed**. GLM's lane turns honey: **won · Clef land 0.94 ·
  landed**. The other two grey out: **lost the race · archived**. Then the real history graph
  of demo-shop: each goal, every attempt, which model, how it ended.
- **Source:** animated lanes; screenshot of the demo-shop History graph.
- **VO:** "A goal can also be a race. Three models, three forks, and all three pass. Clef compares
  them and picks GLM at ninety-four percent. The others are archived with their reasoning kept.
  And the graph shows how every goal became code."

### 7. You stay in charge (3:11 to 3:39)

- **Screen:** a numbered list builds on the left, the current item bright:
  1. **Comment on a line of the diff**: the real diff of a change, with a callout, "Your comment
     on this line: agent reads it before its next step."
  2. **Ask why any line is here**: the real Trunk panel with "Why is this line here?", then a
     chain lights up: line → change → goal → intent → proof → decision.
  3. **Rewind to any step, on any model**: twelve steps of attempt 1 (Kimi K2.7 Code) light up,
     "◀ rewind to step 7", and a new branch grows from step 7: "attempt 2 · DeepSeek V4 Pro, told
     what went wrong".
  4. **Reviewers' asks become lessons**: "What reviewers keep asking for is told to every new
     agent."
- **Source:** screenshots of demo-shop change `c-74109676f8` and camelcheck's trunk panel; the
  comment callout and the rewind are drawn.
- **VO:** "You stay in charge. Comment on a line of a diff, and the agent reads it before its next
  step. Click any line on trunk and ask why it's there: Hive shows the goal, the intent, the proof
  and the decision. Or rewind an attempt to step seven and carry on from there, on another model,
  told what went wrong. And what reviewers keep asking for becomes a lesson every new agent is
  told."

### 8. Big goals: plans and scouts (3:39 to 4:00)

- **Screen:** the real plan for "Find and fix the security vulnerabilities" on vulnshop, the
  camera drifting across it: "A planner split one goal into 7 sub-goals with dependencies · 7 of
  7 landed". Then: **Before a worker starts: a cheap, read-only scout briefs it.** A grey scout
  bee moves through a file tree and lights the files it reads, then a **Scout briefing** fills in:
  where the change belongs, what calls it (from Hive's code graph), what to mirror.
- **Source:** screenshot of `hivegit.dev/r/vulnshop`; the scout is drawn.
- **VO:** "Big goals get a plan. A planner splits the goal into sub-goals with dependencies, and
  agents start as each dependency lands. Before a worker starts, a cheap read-only scout briefs
  it: where the change belongs and what calls it."

### 9. Any agent, any model (4:00 to 4:20)

- **Screen:** **Any agent · any model.** A terminal types:
  `claude mcp add --transport http hive https://hivegit.dev/mcp`, then
  `hive claim <goal> && hive intent --from-diff`, then a plain `git clone` of trunk whose last
  commit carries `Hive-Change-Id`. On the right: **Workers AI · no setup** (Kimi K2.7 Code,
  GLM 5.3, DeepSeek V4 Pro, gpt-oss 120B, Qwen 3.8 27B, qwen3-coder-30b) and **Bring your own ·
  OpenAI-compatible** (`byo/<your-model>`). Below: **Every call priced**, demo-shop's real goal
  costs ($1.53 for the three-model race, $0.10, $0.09) and a budget bar: spending stops at the cap.
- **Source:** typed terminal and cards; costs from the demo-shop dashboard.
- **VO:** "Any agent can join: Claude Code, Codex, anything that speaks MCP, or the command line.
  Trunk is plain git. Run on free Workers AI models, or bring your own endpoint, with every call
  priced and a budget that stops spending."

### 10. Two thousand agents (4:20 to 4:51)

- **Screen:** the swarm returns, bigger: thousands of bees fill a larger comb, thirteen cells red.
  It match-cuts to the real `scale2k` dashboard. Four tiles count up on the beat:
  **1,987** changes landed, **~17** minutes end to end, **125** landings a minute (p50 submit to
  trunk 2.4 min), **13** sent to a person, exactly the 13 broken on purpose. "Simulated agents.
  **Real** forks, queue, merges and tests." A terminal: `git log --oneline | wc -l` prints 1988,
  and the tests pass. Then **Across hivegit.dev so far**: **6,140** changes landed, **15**
  repositories.
- **Source:** coded swarm; screenshot of `hivegit.dev/r/scale2k`; README's verified table;
  hivegit.dev landing page.
- **VO:** "Does it hold up? Two thousand agents, one repository, nothing touched. Nineteen
  eighty-seven changes landed in about seventeen minutes, a hundred and twenty-five a minute.
  Thirteen went to a person: exactly the thirteen I broke on purpose. The agents were simulated;
  the forks, the queue, the merges and the tests were real. Across this deployment so far, six
  thousand one hundred and forty changes have landed in fifteen repositories."

### 11. The record, and close (4:51 to 5:19)

- **Screen:** two terminals side by side. Left, `git log --oneline` of demo-shop's real trunk,
  with a commit's trailers (`Hive-Change-Id`, `Hive-Model`): **git log: what changed.** Right,
  the ledger: `shop.hive/` with `agents.json`, `goals/`, `changes/` (intent, evidence, decisions
  + probabilities) and `transcripts/`: **Hive's ledger: why, who decided, how sure.** Then: "Hive
  imported its own repository and opened its own pull request on GitHub: hivegithq/hive #1,
  merged." The Cloudflare products light up as they're named: Workers, Durable Objects,
  Workflows, Containers, Artifacts, Workers AI. End card over the hive plate: the Hive mark,
  `hivegit.dev · github.com/hivegithq/hive · MIT licence`, one last bee docking into the logo,
  then **Thousands of agents.** **One trunk.**
- **Source:** terminals (commit subjects from demo-shop's trunk, ledger layout from the README);
  plate.
- **VO:** "Git log tells you what changed. Hive's ledger tells you why, who decided, and how sure
  they were. Hive even opened its own pull request. It runs on Workers, Durable Objects, Workflows,
  Containers, Artifacts and Workers AI. It's open source, and live at hivegit.dev. Thousands of
  agents. One trunk."

## Where every number comes from

| On screen | Source |
|---|---|
| 2,000 agents, 1,987 landed, 13 to a person, 125 a minute, ~17 min, p50 2.4 min, 1,988 commits | README, the `scale2k` table |
| Clef land 0.94, review 85/100 | demo-shop change `c-74109676f8` (race winner, GLM 5.3) |
| Conflicts merged by DeepSeek V4 Pro, Clef land 0.90 | camelcheck change `c-038e2a6fdd` |
| Clef would land (0.88), 2 referential conflicts | demo-shop change `c-3ed0c71ada` |
| 7 of 7 sub-goals landed | vulnshop plan |
| 0 introduced, 9 resolved | hivegit.dev landing page (vulnshop) |
| 6,140 changes landed, 15 repositories | hivegit.dev landing page |
| $1.53, $0.10, $0.09 goal costs | demo-shop goals list |

## How it's built

- **Voice:** `video/voice/text/NN.txt` holds each scene's narration with pronunciation fixes
  (GLM → "G L M", hivegit.dev → "hive git dot dev"). Generate with
  `HYPERFRAMES_PYTHON=~/.venvs/kokoro/bin/python npx hyperframes tts video/voice/text/NN.txt -v af_heart -o video/voice/scene-NN.wav`,
  then transcribe it for word timings with `npx hyperframes transcribe` into `video/voice/words/`.
- **Picture:** `video/hive-demo/` is a HyperFrames project. `src/` holds the scenes, styles and
  timeline; `python3 build.py` builds captions from this file's VO lines and writes `index.html`;
  `npx hyperframes render -o renders/hive-demo.mp4 -q delivery` renders it, and an ffmpeg
  `loudnorm` pass to -14 LUFS writes `hive-demo-final.mp4`. Product screenshots come from
  `video/capture/*.mjs` (Playwright at 2x).
- **Editing the words:** the VO lines above are what `build.py` reads for captions. Change a line
  here, regenerate that scene's audio and word timings, then rebuild and render.
