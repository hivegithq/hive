# Changelog

All notable changes to Hive. Versions follow [semantic versioning](https://semver.org).

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

[1.0.0]: https://github.com/karanbalaji/hive/releases/tag/v1.0.0
