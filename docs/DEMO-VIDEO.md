# Demo video: script and storyboard

Length 9:30, 16:9, 1080p, for the Cloudflare competition (5 to 10 minutes). Narration is spoken
by one voice, calm and precise, no hype. Total narration is about 950 words (about 6.5 minutes spoken), so the live moments have room to breathe.

## What the video has to do

The judges score three things, so each scene is built to carry one:

| Weight | What they score | Scenes |
|---|---|---|
| 50% | Originality and quality of the prototype for agent-oriented collaboration | 1, 2, 9, 10 |
| 25% | Multi-agent concurrency, coordination, context preservation, review, conflict handling | 3, 4, 5, 6, 7, 8 |
| 25% | Ease of use and experience | 3, 6, 8, and the dashboard throughout |

## Rules for the look and the sound

These come from how the best code-made videos are built: a real product on screen, not an
imitation of it, and a loop that looks at its own frames before anything is shown.

- **Real screens only.** Every product shot is a screen recording of hivegit.dev or the terminal.
  Nothing about the product is redrawn from imagination. Motion graphics only carry numbers and
  the transitions between scenes.
- **Palette:** night `#0d0d0f`, honey `#fbad41` as the one accent, flare `#f6821f` for work in
  progress, steel `#7d8da1`, alarm `#f0605d` only for "needs a person". Wax `#fff4e0` for text.
- **Type:** Chakra Petch for titles, JetBrains Mono for anything typed or from the terminal.
- **No defaults:** no centred title on a gradient, no everything-fades-in, no frame borders or
  corner labels, no glow on interface chrome. Something new happens every 2 to 4 seconds.
- **Plates:** two generated backgrounds (DreamLayer) for the opening and the problem scene, in
  `video/assets/`. They are backgrounds only; no text or logos in them.
- **Sound:** a quiet pulse that tightens as more agents appear, a soft tick on every landing, a
  low tone on every "needs a person". Hits sit on the beat grid. Voice first, music at -22 dB
  under it, final loudness about -14 LUFS.
- **Render:** every frame is a function of time (`seek(t)`), so a fix is an edit and a re-render.
  Before a full render: render one frame per beat as a contact sheet, look at it, score it 1 to
  10 on hook, readability at phone size, motion, variety, accuracy and sound sync, fix the three
  worst, repeat until all are 8 or more.

## Storyboard and script

Times are cumulative. **VO** is the narration, word for word. **Screen** is what is on screen.
**Source** is where the footage comes from.

### 1. Cold open (0:00 to 0:25)

- **Screen:** the converging plate (`video/assets/hive-plate.jpg`) drifts slowly. Hexagons stream
  left to right into one bright trunk. At 0:06 the line "Thousands of agents." is set in big type
  on the left; at 0:09 "One trunk." lands in honey. At 0:13 cut hard to the real dashboard of the
  2,000-agent run: the map of cells, almost all honey.
- **Source:** plate; recording of `hivegit.dev/r/scale2k`.
- **Sound:** pulse starts at the first hexagon; one tick as the second line lands.
- **VO:** "This is Hive. Two thousand agents worked on one repository at the same time. Nineteen
  hundred and eighty-seven of their changes landed, with nobody touching anything. Every one
  that didn't land was broken on purpose. Here is how that works, and why Git can't do it."

### 2. The problem (0:25 to 1:05)

- **Screen:** the problem plate (grey lines fanning out, red sparks where they collide). Four
  questions appear one at a time, left-aligned, each answered a beat later in a smaller line.
  The sparks pulse on the collision as each question appears.
  1. "Who is touching what, right now?"
  2. "Will these two changes break each other?"
  3. "Should this land?"
  4. "Why is the code like this?"
- **Source:** plate; typography only.
- **VO:** "Git was built for a handful of people who talk to each other: in meetings, in chat, in
  pull request threads. Agents can't. Put fifty of them on one codebase and four things break.
  Nobody knows who is touching what until a pull request appears. Two edits on different lines
  can still break the program, and Git won't notice. A green badge and an approval click don't
  scale to a thousand changes a day. And the reasoning behind a change ends up in a thread
  outside the repository."

### 3. What Hive is (1:05 to 1:45)

- **Screen:** the four answers become four short lines over the real dashboard map, each with a
  cell lighting up:
  - "Every change gets its own repository."
  - "Agents say what they'll touch before they write code."
  - "A queue rebases, tests, reviews, and lands only when it's sure."
  - "Everything is recorded in git, next to the code."
  Then the Cloudflare products appear as small labels where each one does its job (Artifacts
  for the forks, Durable Objects for the coordinator, Workflows for batches, Containers for the
  workspaces, Workers AI for the models).
- **Source:** recording of `hivegit.dev/r/demo-shop` before the swarm.
- **VO:** "Hive replaces branches and pull requests with four ideas. Every change gets its own
  fork, which is a real Artifacts repository. Agents declare the files and symbols they're about
  to change before they write a line, and hear about collisions straight away. A convergence
  queue rebases each change, runs the tests, has it reviewed, and lands it only when a calibrated
  model is sure. And everything, the intents, the evidence, the decisions, even the agents'
  transcripts, is committed to git, next to the code. The whole thing runs on Cloudflare."

### 4. A swarm, live (1:45 to 3:15)

- **Screen:** terminal: `node demo/swarm.ts` prints six goals and models. Cut to the dashboard
  on `/r/demo-shop`: six strips appear in Working. Click one: "its own Artifacts repo, forked
  from trunk". Notches appear as intents arrive. Zoom on the pair that touch `checkout()`
  (structural) and on `parsePrice` against the code that calls it (referential), with Clef's
  advice text. Time-lapse: strips move to In queue, Converging, Landed, with the tick on each
  landing. One strip turns alarm-red: "needs a person".
- **Source:** live recording of the swarm on `hivegit.dev/r/demo-shop` (sped up 8 to 10 times in
  the middle, normal speed on the overlap moments). Terminal: `node tools/watch.ts demo-shop`
  in a corner.
- **VO:** "Here are six agents on three different models, all started at once. Each one is
  forked from trunk. As they declare intent, Hive compares them. Two of them are about to change
  the same function. That's a structural overlap, and it's caught before any code exists. A
  third is changing what a function returns while another edits code that calls it. Git would
  merge that happily and ship a bug. Hive's code graph sees it, and Clef, the decision model,
  tells the agent to narrow its scope. Disjoint changes land first. And the one change that
  couples to code trunk changed in the meantime is held for a person, because that's a decision
  worth a person's attention."

### 5. Convergence: evidence, opinion, decision (3:15 to 4:20)

- **Screen:** open a change in Converging. The drawer shows, in order: rebase with mergiraf,
  typecheck, tests (green ticks), then the review labelled "An opinion from the review model,
  not a test result", then the decision with its probabilities: "land 0.93". Then the same
  drawer for a change that conflicted: Hive's evidence line "conflicts merged by DeepSeek V4
  Pro", and the change landing on its first attempt. On screen: the setting "Merge conflicts: let
  a model merge them".
- **Source:** recordings of `demo-shop` changes and of `camelcheck` change `c-038e2a6fdd`.
- **VO:** "Every change goes through the same line. It's rebased with a structural merge that
  understands code. It's typechecked and tested. A model writes a review, and the review is
  labelled as an opinion, because tests are evidence and a review is not. Then Clef gives a
  calibrated probability. Ninety-three percent land, so it lands. When Clef isn't sure, a person
  decides. When two agents changed the same line, a model can merge it in the queue, and the
  tests still decide. This change landed on its first attempt, where a bounce would have cost an
  agent four minutes redoing a merge."

### 6. A race (4:20 to 4:55)

- **Screen:** three lanes for the same goal, Kimi, GLM and DeepSeek, each in its own fork. All
  three pass their tests. The lanes show review scores and Clef's probabilities; GLM's lane turns
  honey ("won, landed") and the other two grey out ("archived"). Then the History view switches
  from List to Graph: the goal on the left, three attempts, their outcomes.
- **Source:** recording of the race on `demo-shop` and the Graph tab on `camelcheck`.
- **VO:** "A goal can also be a race. Three models try the same task in three forks. All three
  pass. Clef compares them side by side and picks GLM at ninety-three percent. The other two are
  archived with their reasoning kept. Best-of-N is a version-control feature here, not a prompt
  trick. And this graph shows how any goal became code: every attempt, which model, how it ended,
  and the pull request it became."

### 7. Reviewing, steering and rewinding (4:55 to 6:25)

- **Screen:** five quick moments, each a real click, about 15 seconds each:
  1. **Comment on a line** of the diff, send it; the agent's next step reads it.
  2. **Why is this line here?** Click a line in Trunk: the change, goal, intent, proof, decision.
  3. **Rewind:** pick step 7 of an attempt, "carry on from here", on another model.
  4. **Fix:** "Have the reviewer fix these": the reviewer model continues from a copy and lands.
  5. **Context window:** the breakdown of where an agent's tokens went, per step.
  End on the lessons panel: "what reviewers asked for is told to every new agent".
- **Source:** recordings of `camelcheck` and `uuid` (signed in as owner for the writes).
- **VO:** "You stay in charge of the work. Comment on a line of the diff and the agent reads it
  before its next step. Ask why any line is here, and Hive shows the change, the goal, the intent,
  the proof and the decision. Rewind an attempt to step seven and carry on from there, or try
  again on another model, told what went wrong last time. Let the reviewer fix its own concerns
  from a copy of the change. See where an agent's context window went. And what reviewers asked
  for becomes a lesson every new agent is told."

### 8. Big goals: plans, scouts, and asking the owner (6:25 to 7:20)

- **Screen:** the plan graph for "Find and fix the security vulnerabilities": a planner
  (GLM 5.3) proposed seven sub-goals with dependencies; cells light as agents start when their
  dependencies land. Open one sub-goal's change: the scout's briefing appears in its
  conversation. Then an agent's log line: "asked about src/discount.ts#applyDiscount: 0 working on
  it, 2 landed before", and the answer text with why those changes landed.
- **Source:** `hivegit.dev/r/vulnshop` (the real plan) and the `camelcheck` change `c-654f202deb`.
- **VO:** "Big goals get a plan. A planner reads the code and splits the goal into sub-goals with
  dependencies, and agents start as each one's dependencies land. Before a worker starts, a cheap
  read-only scout looks at the code and briefs it: where the change belongs, what calls it, what
  to mirror. And an agent that's about to touch code it didn't write can ask whoever owns it: if
  another agent is working there, it's messaged; if not, Hive answers from the record of what
  landed there and why."

### 9. Any agent, any model (7:20 to 8:05)

- **Screen:** split screen. Left: Claude Code adding the MCP server and claiming a goal
  (`claude mcp add --transport http hive https://hivegit.dev/mcp`). Right: the Rust CLI
  `hive claim … && hive intent --from-diff` declaring exactly the symbols the diff changes.
  Then a terminal `git clone` of trunk: plain git, every commit with `Hive-*` trailers. Then
  the model picker showing Workers AI free models, then a second block of `byo/…` models from an
  OpenAI-compatible endpoint, with the cost per goal and a budget bar.
- **Source:** terminal and dashboard recordings.
- **VO:** "Hive isn't tied to its own agents. Claude Code, Codex, or any agent that speaks MCP
  can claim a goal. The command line does the same, and it declares exactly the symbols your diff
  changed. Trunk is real git: clone it with any client. Agents run on Workers AI's free models
  with no setup, or on any OpenAI-compatible endpoint with your own key. Every call is priced,
  and a goal can have a budget that stops spending."

### 10. Two thousand agents (8:05 to 8:40)

- **Screen:** the `scale2k` dashboard time-lapse: the board fills. Numbers land one at a time in
  type, each tied to a real figure on screen: "1,987 landed", "13 sent to a person: exactly the 13
  broken on purpose", "125 landings a minute", "17 minutes". Then a terminal: `git clone` and
  `git log --oneline | wc -l` prints 1988, and the tests pass.
- **Source:** recording of `hivegit.dev/r/scale2k`, README's verified table.
- **VO:** "To see if it holds up, I ran two thousand agents on one repository and touched nothing.
  Nineteen eighty-seven changes landed, in about seventeen minutes, a hundred and twenty-five a
  minute. Thirteen went to a person: exactly the thirteen I broke on purpose. Afterwards, a plain
  git clone shows one commit per change, every one with a unique ID, and the tests pass. These
  agents are simulated, so they don't spend model tokens, but the forks, the queue, the merges
  and the tests are all the real thing."

### 11. The record, and Hive builds Hive (8:40 to 9:10)

- **Screen:** `git clone` of the ledger repository: folders `goals/`, `changes/`, `transcripts/`;
  a decision file with its probabilities. Then `hivegit.dev/r/hive`: the Hive repository imported
  into Hive, its goal "Add CONTRIBUTING.md", passing its own checks, and the pull request that
  opened on GitHub.
- **Source:** terminal; recording of `hivegit.dev/r/hive`; GitHub PR #1 (merged).
- **VO:** "Years from now, git log tells you what changed, and the ledger tells you why, who
  decided, and how sure they were. And Hive builds itself. I imported Hive's own repository into
  Hive. It passed its own checks and opened its own pull request, with the same evidence."

### 12. Close (9:10 to 9:30)

- **Screen:** quick list of Cloudflare products with their jobs (Workers, Durable Objects, Agents
  SDK, Workflows, Containers, Artifacts, Workers AI), then the converging plate returns. The final
  card: "Hive: thousands of agents, one trunk." with `hivegit.dev` and the GitHub address, and
  "MIT licence".
- **Source:** plate; typography.
- **VO:** "Hive is built on Workers, Durable Objects, the Agents SDK, Workflows, Containers,
  Artifacts and Workers AI. It's open source under the MIT licence, and you can watch it live at
  hivegit.dev. Thousands of agents. One trunk."

## Before recording

- Nothing running on the showcase repositories. Check `sampleproject`, `uuid`, `hive`,
  `camelcheck`, `demo-shop` and `scale2k` are idle before deploying anything.
- Sign in on the dashboard for the scenes that write (comment, rewind, reviewer fix). Record the
  rest signed out, to show that anyone can watch.
- Turn `autoResolve` on for `camelcheck` (it already is).
- A paid model can die mid-run. Have the restart ready, and don't rely on timing; cut to a
  prerecorded take if needed.
- Record at 2560 x 1440, scale down to 1080p. Hide bookmarks and notifications.
- Read the narration at an even pace. If the video runs past 9:45, cut scene 9 first, then
  shorten scene 7 to its first three moments.

## If this is rendered from code

Build one `index.html` per scene with `window.seek(t)`, capture the screen recordings as video
layers, and render with Playwright frame by frame and ffmpeg. The two plates are static images
under slow camera moves. Synthesise the pulse, ticks and low tones in code, place them on the
beat grid, and mix the voice over them. Keep the narration as one audio file and the scene
timings in a JSON file, so a change in wording is a re-render, not a rebuild.
