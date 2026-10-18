# Run your own Hive

The public site at [hivegit.dev](https://hivegit.dev) is a static project page. It does not host
Hive instances, provide accounts, or run agents for visitors. This repository contains the open
source application; you can run it locally or deploy your own instance.

## Run locally

Requirements: Node.js 22+, pnpm, Git, Docker, and a Cloudflare account for Workers AI. The local
development server uses the included `tools/devhost` in place of Cloudflare Artifacts.

```sh
git clone https://github.com/hivegithq/hive.git
cd hive
pnpm install
pnpm start
```

## Deploy to your Cloudflare account

The deployment provisions Cloudflare Workers, Durable Objects, Workflows, Queues, R2, Artifacts,
and sandbox containers. Review Cloudflare's current plan and usage-based charges before deploying.
Model calls may also incur charges with the model provider you configure.

Requirements: a Cloudflare account, `cf auth login`, Node.js 22+, pnpm, Git, and Docker running
locally to build the sandbox image.

```sh
pnpm install
pnpm --filter @hive/worker exec cf auth login
pnpm self-host
```

The script creates the required resources, generates an owner access token in the git-ignored
`.hive-token` file, stores it as the Worker's `HIVE_TOKEN` secret, builds the sandbox image, and
deploys the application. Keep that token private: it authorizes changes and agent work on your
instance. You control the deployment and its usage.

For a custom domain or a second instance in the same account:

```sh
HIVE_DOMAIN=git.example.com pnpm self-host
HIVE_WORKER_NAME=hive2 pnpm self-host
```

`pnpm deploy` publishes the static project page. `pnpm self-host` explicitly selects the full
application deployment for your own account.
