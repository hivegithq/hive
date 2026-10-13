# Contributing to Hive

Thanks for helping. Hive is version control for many AI agents working on one codebase, built on
Cloudflare. This is how to get a change in.

## Run it locally

You need Node 22 or newer, pnpm, git, Docker (running), and a Cloudflare account for Workers AI (the
free plan is enough).

```sh
git clone https://github.com/hivegithq/hive && cd hive
pnpm install
pnpm --filter @hive/worker exec cf auth login   # once
pnpm start                                      # devhost on :8788, the Worker and dashboard on :5173
node demo/seed.ts                               # a demo repository to look at: /r/shop
```

[Run it locally](https://hivegit.dev/docs/local) in the docs covers the details.

## Before you open a pull request

Run what the checks run:

```sh
cd apps/worker
npx cf workers types && npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.web.json
npx vitest run
cd ../.. && cargo test
```

- Add a test for new behaviour. Pure logic (policy, planning, parsing) has plenty of examples next
  to the code it covers (`*.test.ts`).
- Match the surrounding code: naming, comment density, idiom.
- Keep a change focused. Several small pull requests review better than one large one.
- Add a line to `CHANGELOG.md` under Unreleased for anything a user would notice.

## Opening the pull request

Fork the repository, branch from `main`, and open a pull request against it. Describe what changed
and why, and how you checked it. CI runs the type checks, the Worker tests and `cargo test`.

## How Hive reviews changes

Hive runs on itself: changes to this repository can go through Hive's own merge queue, which runs
the same checks, then a model review and a calibrated decision (Clef). A change that fails its
checks never lands; one Clef isn't sure about waits for a person. The [docs](https://hivegit.dev/docs/dashboard)
explain goals, races and plans.

## Security

Please don't open a public issue for a vulnerability. Email the maintainer through the address on
their [GitHub profile](https://github.com/karanbalaji).

## License

By contributing, you agree that your contribution is licensed under the [MIT license](LICENSE).
