# Hive concepts

Git was designed for a few humans who coordinate out of band: in meetings, in chat, by
reading each other's pull requests. Agents don't have the out of band. Put fifty of them on
one codebase and the questions Git never had to answer become the whole problem:

- **Who is touching what, right now?** Branches are invisible until someone opens a PR.
- **Will these two changes break each other?** Git only sees lines. Two edits on different
  lines can still be a semantic conflict.
- **Should this land?** A green CI badge and an approval click don't scale to a thousand
  changes a day, and neither tells you how sure anyone was.
- **Why is the code like this?** The commit message says what changed. The reasoning,
  the evidence and the decision live in a PR thread that isn't part of the repository.

Hive replaces branches and pull requests with five primitives.

## Goal

A desired outcome: "Free shipping on orders over $50". It replaces the issue and the PR
description. A goal owns one or more changes: one when a single agent works on it, several
when agents race.

## Change

One attempt at a goal, by one agent, in **its own repository**: an Artifacts fork of trunk.
Isolation is a whole repo, not a branch, so agents can't step on each other's refs, every
fork has its own access token, and a fork is cheap enough to make one per task.

Each change has a stable `Hive-Change-Id` (the Gerrit and Jujutsu idea) that survives
rebases, and records its *genesis*: the trunk commit it started from.

## Intent

Before editing, an agent declares what it is about to change: a summary, the files, and the
**symbols** (`checkout`, `Cart.add`). The coordinator compares it against every live intent
using a semantic graph of trunk, built by tree-sitter, at three levels (from vai):

| Level | Meaning | Example |
|---|---|---|
| Textual | Same file, different symbols | Both edit `price.ts` |
| Structural | Same symbol | Both change `checkout()` |
| Referential | One changes a symbol the other's code calls | One changes what `parsePrice` returns while the other edits `checkout`, which calls it |

Overlaps are reported **before any code is written**. A calibrated model (Clef) rates the
severity and advises: proceed, narrow your scope, wait for the other change, or negotiate,
in which case agents message each other through the coordinator.

## Evidence and evaluation

Evidence is deterministic: a structural rebase onto trunk (mergiraf), typecheck, tests, build.
An evaluation is an opinion: a review model's summary and concerns, plus Clef's calibrated
score. Hive keeps them apart everywhere (in the API, the dashboard and the ledger), because
"the tests passed" and "a model thinks it looks fine" are different kinds of claims (from newgit).

## Decision and convergence

There are no merge buttons. Submitted changes enter a **convergence queue** that:

1. Lands changes that touch nothing anyone else is touching first, so they can't conflict
   (writ's ordering).
2. Rebases each change onto current trunk with mergiraf as the merge driver, so conflicts
   that are only textual (imports, adjacent edits, reordered members) resolve themselves.
3. Runs `hive-merge referential` to catch the conflicts git can't see.
4. Gathers evidence, gets a review, and asks Clef: land, bounce or escalate. Clef returns
   probabilities, not a yes/no.
5. **Lands** when Clef is at least 85% sure (writ's threshold), discounted by how much Hive
   trusts the agent; trust grows with each clean landing. It **bounces** back to the agent
   with the failing evidence and conflict excerpts, and the agent fixes it and resubmits. It
   **escalates** to a person when the model isn't sure.

Only the coordinator writes trunk, one change at a time, so trunk is always the result of a
decision that is on record.

## Race mode

For goals where the approach is uncertain, Hive can fan one goal out to several agents running
different models, in parallel forks. Each candidate gets evidence, a review and a preview
deployment. Clef judges the finished candidates side by side, and a person can override. Only the
winner enters the convergence queue. The others are archived with their reasoning intact.

## The ledger

Everything above is mirrored as JSON into a companion repository, `<repo>.hive`: goals,
intents, evidence, evaluations, decisions and every agent's full transcript. Clone it with any git
client to audit why trunk looks the way it does, without Hive, years later. This is the Radicle
idea: collaboration metadata belongs in git, not in a vendor's database.
