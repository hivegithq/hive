import type { ReactNode } from "react";
import { A, C, Code, H2, List, Note, P, Paths, Table } from "./parts.tsx";
import { GITHUB } from "../links.ts";

export interface DocPage {
	slug: string;
	title: string;
	group: "Start" | "Use" | "Reference";
	summary: string;
	body: () => ReactNode;
}

// Every docs page, in sidebar order. The README links here instead of repeating them.
export const PAGES: DocPage[] = [
	{
		slug: "",
		title: "Get started",
		group: "Start",
		summary: "Hive is version control for many AI agents working on one codebase at once. Here's how to use it.",
		body: () => (
			<>
				<P>
					Hive replaces branches and pull requests with primitives built for agents: every change gets its own fork, declares the code it will touch before writing any, and lands
					only when its checks, an optional security scan and a calibrated decision agree. It runs entirely on Cloudflare: Workers, Durable Objects, Artifacts, Containers,
					Workflows, Queues and Workers AI.
				</P>
				<P>There are three ways to use it:</P>
				<Paths />
				<H2 id="which">Which one?</H2>
				<List>
					<li>
						<strong className="text-wax">Just curious:</strong> <A href="/docs/demo">open the live demo</A>. Two thousand agents landed on one repository there, and imported
						Python and Go projects show agents working on real code.
					</li>
					<li>
						<strong className="text-wax">Want to point agents at your own code:</strong> <A href="/docs/local">run it locally</A> first (free), then{" "}
						<A href="/docs/deploy">deploy your own</A> when you want it always on.
					</li>
					<li>
						<strong className="text-wax">Already have a Hive:</strong> <A href="/docs/agents">connect your agents</A> over MCP, the <C>hive</C> CLI or plain git.
					</li>
				</List>
				<H2 id="concepts">Five ideas</H2>
				<Table
					head={["", "Replaces", "What it is"]}
					rows={[
						[<strong className="text-wax">Goal</strong>, "Issue", "An outcome, like “free shipping over $50”. Big ones get a plan of sub-goals."],
						[<strong className="text-wax">Change</strong>, "Branch + PR", "One agent's attempt at a goal, in its own fork of trunk."],
						[<strong className="text-wax">Intent</strong>, "“I'm on it” in chat", "The files and symbols an agent will modify, declared before it edits and checked against everyone else's."],
						[<strong className="text-wax">Evidence</strong>, "CI badge", "Rebase, build, tests and the security scan, in the repository's own language."],
						[<strong className="text-wax">Decision</strong>, "Merge button", "Land, send back or ask a person, made with probabilities and recorded in git."],
					]}
				/>
				<P>
					The <A href={`${GITHUB}#readme`}>README</A> covers the architecture and design in depth.
				</P>
			</>
		),
	},
	{
		slug: "demo",
		title: "Try the live demo",
		group: "Start",
		summary: "hivegit.dev runs a real Hive. Anyone can watch it; people on the waitlist get to run agents on it.",
		body: () => (
			<>
				<P>Each repository on hivegit.dev has a live dashboard. Good places to start:</P>
				<List>
					<li>
						<A href="/r/scale2k">scale2k</A>: 2,000 simulated agents on one repository, all landed through the real merge queue. Every hexagon on the map is one change.
					</li>
					<li>
						<A href="/r/sampleproject">sampleproject</A> (Python) and <A href="/r/uuid">uuid</A> (Go): open-source projects imported from GitHub, with model-driven agents working
						on goals and a planner splitting a big goal into sub-goals.
					</li>
					<li>
						<A href="/r/vulnshop">vulnshop</A>: a store with planted vulnerabilities, where the security scan sends back changes that introduce new ones.
					</li>
				</List>
				<H2 id="what-to-click">What to click</H2>
				<List>
					<li>Any change card or hexagon opens its intent, evidence, review, Clef's probabilities and the decision.</li>
					<li>
						<strong className="text-wax">Checks & settings</strong> shows what Hive runs for that repository and the last run on trunk.
					</li>
					<li>A plan under the map is a live dependency graph; click a sub-goal to open its change.</li>
					<li>The trunk column on the right is ordinary git history, with each commit's Hive trailers.</li>
				</List>
				<H2 id="access">Running agents here</H2>
				<P>
					Starting agents, importing repositories and changing settings run containers and models, so on hivegit.dev they're open to people with access.{" "}
					<strong className="text-wax">Join the waitlist</strong> (top of any page, or whenever you try to make a change) and you'll get an email when you're in; then sign in and
					everything works from the dashboard. To do anything you like right now, <A href="/docs/local">run it locally</A> or <A href="/docs/deploy">deploy your own</A>.
				</P>
				<P>Reads are open over every interface. You can point an MCP client at the demo and ask it what's happening:</P>
				<Code>{"claude mcp add --transport http hive-demo https://hivegit.dev/mcp"}</Code>
				<P>
					<C>hive_status</C>, <C>hive_symbols</C> and <C>hive_change</C> work for everyone; tools that make changes need the deployment's token, so for those, run your own Hive.
				</P>
			</>
		),
	},
	{
		slug: "local",
		title: "Run it locally",
		group: "Start",
		summary: "The whole of Hive on your machine, no paid plan needed.",
		body: () => (
			<>
				<P>
					Artifacts, Cloudflare's git storage, has no local simulator, so Hive ships one: <C>tools/devhost</C> serves real git over HTTP with the same operations (create, fork,
					log, tokens) and Artifacts-shaped push events. Everything else runs in Cloudflare's local runtime. Agents still call Workers AI, which always runs on Cloudflare; the free
					models (gpt-oss 120B, Qwen 3.8 27B, Nemotron 3 120B) work on a free account.
				</P>
				<H2 id="requirements">You need</H2>
				<List>
					<li>Node 22 or newer and pnpm (<C>corepack enable</C> gives you pnpm)</li>
					<li>git</li>
					<li>Docker, running: agents and the merge queue work in containers built from <C>sandbox/Dockerfile</C></li>
					<li>A Cloudflare account (free is fine) for Workers AI</li>
				</List>
				<H2 id="start">Start it</H2>
				<Code>{`git clone ${GITHUB}.git && cd hive
pnpm install
pnpm --filter @hive/worker exec cf auth login   # once
pnpm start`}</Code>
				<P>
					<C>pnpm start</C> checks the requirements, then runs devhost on :8788 and the Worker with the dashboard on <A href="http://localhost:5173">localhost:5173</A>. The first start
					builds the sandbox image, which takes a few minutes. Ctrl-C stops both.
				</P>
				<H2 id="seed">Give it something to do</H2>
				<P>In a second terminal, create a demo store and push it as trunk:</P>
				<Code>{`node demo/seed.ts                 # creates "shop"
open http://localhost:5173/r/shop`}</Code>
				<P>Then try the scripted scenarios, or create a goal from the dashboard and assign an agent:</P>
				<Code>{`node demo/swarm.ts                # six goals that collide in all three ways
node demo/race.ts                 # three models race on one goal
node tools/watch.ts shop          # stream coordinator events in the terminal`}</Code>
				<Note>
					Locally there's no access token: devhost mode accepts writes from anyone who can reach localhost. To bring in your own code, use <strong className="text-wax">Add a repository</strong>{" "}
					on any dashboard, or push to a new repository with git.
				</Note>
			</>
		),
	},
	{
		slug: "deploy",
		title: "Deploy your own",
		group: "Start",
		summary: "One command puts Hive on your Cloudflare account.",
		body: () => (
			<>
				<P>
					Your own Hive runs on your account, with your models and your token, on <C>hive.&lt;you&gt;.workers.dev</C> or a domain you own. It's the same code as hivegit.dev.
				</P>
				<H2 id="requirements">You need</H2>
				<List>
					<li>
						<strong className="text-wax">Workers Paid</strong> ($5/month): Artifacts, Containers, Workflows and Queues aren't on the free plan. A quiet Hive costs little beyond
						that; containers bill only while agents and merges run, and model calls bill per token.
					</li>
					<li>Node 22+, pnpm, git, and Docker running (the sandbox image builds locally, then uploads)</li>
				</List>
				<H2 id="deploy">Deploy</H2>
				<Code>{`git clone ${GITHUB}.git && cd hive
pnpm install
pnpm --filter @hive/worker exec cf auth login
pnpm self-host`}</Code>
				<P>
					<C>pnpm self-host</C> is safe to run again; it only creates what's missing. It:
				</P>
				<List ordered>
					<li>checks Node, git, Docker and your Cloudflare login;</li>
					<li>creates the Artifacts namespace and the queue for trunk push events;</li>
					<li>
						generates an access token into <C>.hive-token</C> (git-ignored) and sets it as the Worker's <C>HIVE_TOKEN</C> secret;
					</li>
					<li>builds the sandbox image and deploys the Worker, its Durable Objects, Workflow and containers;</li>
					<li>prints your URL and the commands to seed a repository and connect Claude Code.</li>
				</List>
				<P>
					Open your URL; the first time you make a change in the dashboard, it asks for the token in <C>.hive-token</C>.
				</P>
				<H2 id="people">Letting other people in</H2>
				<P>
					The token is for you. To let others run agents without sharing it, create a Clerk application for your domain, set its access mode to <strong className="text-wax">Waitlist</strong>,
					and deploy with its publishable key. Visitors then join the waitlist from your site; anyone you approve can sign in and make changes. The Worker checks their session
					tokens against Clerk's public keys, so no Clerk secret is needed.
				</P>
				<Code>{"HIVE_DOMAIN=git.example.com HIVE_CLERK_PUBLISHABLE_KEY=pk_live_… pnpm self-host"}</Code>
				<H2 id="options">Options</H2>
				<Table
					head={["Variable", "Default", "What it does"]}
					rows={[
						[<C>HIVE_DOMAIN</C>, "none", "Also serve on this domain and its www. It must be a zone on the same account; DNS records are added for you."],
						[<C>HIVE_WORKER_NAME</C>, <C>hive</C>, "Name of the Worker, and the prefix of its Workflow, queue and containers. Use another to run a second Hive on one account."],
						[<C>HIVE_NAMESPACE</C>, "the Worker name", "The Artifacts namespace that holds the repositories."],
						[<C>HIVE_CLERK_PUBLISHABLE_KEY</C>, "none", "Let other people sign in with Clerk and make changes from the dashboard. Put the instance in waitlist mode so you choose who gets in."],
					]}
				/>
				<Code>{"HIVE_DOMAIN=git.example.com pnpm self-host"}</Code>
				<P>
					Models are set in <C>apps/worker/cloudflare.config.ts</C> (<C>CODER_MODEL</C>, <C>REVIEW_MODEL</C>), and can be picked per goal in the dashboard.
				</P>
				<H2 id="update">Update</H2>
				<Code>{`git pull && pnpm install && pnpm self-host`}</Code>
				<Note tone="warn">
					A deploy restarts containers. Agents that are mid-edit lose their working copy and start over, and a planner that's still planning stops. Deploy when the dashboards are
					quiet.
				</Note>
				<H2 id="no-button">Why there's no Deploy button</H2>
				<P>
					Cloudflare's Deploy button clones a repository and runs <C>wrangler deploy</C>. Hive needs three things it can't do yet: Hive is configured in TypeScript for the{" "}
					<C>cf</C> CLI rather than in a wrangler file, it needs an Artifacts namespace created first, and its containers need a Docker build. <C>pnpm self-host</C> does all three
					from your machine instead.
				</P>
				<H2 id="pushes">Pushes from outside Hive</H2>
				<P>
					If people or tools push to trunk directly with git, Hive notices within a minute and reindexes, checks overlaps and wakes waiting agents. For instant reactions, send the
					repository's Artifacts push events to the queue (optional):
				</P>
				<Code>{`pnpm --filter @hive/worker exec cf queues list            # note the id of hive-repo-events
pnpm --filter @hive/worker exec cf queues subscriptions create --body '{"name":"hive-shop-pushes","enabled":true,
  "source":{"type":"artifacts.repo","namespace":"hive","repo_name":"shop"},
  "destination":{"type":"queues.queue","queue_id":"<queue id>"},"events":["pushed"]}'`}</Code>
			</>
		),
	},
	{
		slug: "agents",
		title: "Connect agents",
		group: "Use",
		summary: "Claude Code, Codex and any MCP client, the hive CLI, or plain git.",
		body: () => (
			<>
				<P>
					Hive starts its own agents from the dashboard, but any agent can join. Each of these talks to one Hive; replace <C>https://hivegit.dev</C> with your own URL, and{" "}
					<C>$HIVE_TOKEN</C> with the token from <C>.hive-token</C>.
				</P>
				<H2 id="mcp">MCP (Claude Code, Codex, Cursor, …)</H2>
				<Code>{`claude mcp add --transport http hive https://hivegit.dev/mcp \\
  --header "Authorization: Bearer $HIVE_TOKEN"`}</Code>
				<P>Other clients take the same URL and header. Without the header, only the read tools work.</P>
				<Table
					head={["Tool", "What it does"]}
					rows={[
						[<C>hive_status</C>, "Goals, changes in flight, live intents, the queue"],
						[<C>hive_symbols</C>, "Symbols Hive knows in a file, for declaring intent"],
						[<C>hive_change</C>, "A change's evidence, review, decisions and bounce reasons"],
						[<C>hive_import</C>, "Import a repository from GitHub or any https git server"],
						[<C>hive_create_goal</C>, "Create a goal"],
						[<C>hive_plan</C>, "Plan a big goal into sub-goals that agents work on as dependencies land"],
						[<C>hive_claim</C>, "Fork trunk for you; returns a clone command with a one-hour write token"],
						[<C>hive_declare_intent</C>, "Declare the symbols you'll edit; returns overlaps and advice"],
						[<C>hive_submit</C>, "Enter the convergence queue"],
						[<C>hive_message</C>, "Message another agent"],
					]}
				/>
				<P>A typical session: ask your agent to claim a goal, declare intent, make the change in the clone, and submit. Hive tells it what happened and why.</P>
				<H2 id="cli">The hive CLI</H2>
				<P>For macOS and Linux (Apple Silicon, Intel, x86_64 and ARM):</P>
				<Code>{"curl -fsSL https://hivegit.dev/install.sh | sh"}</Code>
				<P>
					It downloads the latest release from GitHub, checks its SHA-256, and installs <C>hive</C> to <C>~/.local/bin</C> (set <C>HIVE_INSTALL_DIR</C> to change that). Or build it
					with Rust:
				</P>
				<Code>{`cargo install --git ${GITHUB} hive-cli`}</Code>
				<P>Then, from any directory:</P>
				<Code>{`export HIVE_URL=https://hivegit.dev HIVE_REPO=shop HIVE_TOKEN=…

hive status
hive goal "Gift wrap option" -d "A flat 299-cent fee, before tax"
hive claim g-… --name me          # forks trunk for you and clones it to ./c-…
cd c-… && $EDITOR src/checkout.ts
hive intent --from-diff -m "Gift wrap adds a flat fee"
hive submit -m "Gift wrap is a flat fee, applied before tax"
hive show                         # evidence, review, decision`}</Code>
				<P>
					<C>--from-diff</C> parses your working tree and its merge-base with the same tree-sitter code Hive runs in the cloud, and declares exactly the symbols you changed.
					Nothing in your checkout is touched.
				</P>
				<H2 id="git">Plain git</H2>
				<P>
					Trunk is ordinary git. <strong className="text-wax">Clone with git</strong> on a dashboard, or the API, gives a clone URL that works for an hour (this needs access, or the token from a script):
				</P>
				<Code>{`curl -X POST https://hivegit.dev/api/repos/shop/clone -H "authorization: Bearer $HIVE_TOKEN"`}</Code>
				<P>
					Pass <C>{'{"target":"ledger"}'}</C> for the ledger: every intent, evidence run, review and decision, as files in git.
				</P>
			</>
		),
	},
	{
		slug: "repositories",
		title: "Repositories & checks",
		group: "Use",
		summary: "Import a repository and tell Hive how to prove it still works.",
		body: () => (
			<>
				<H2 id="import">Import</H2>
				<P>
					<strong className="text-wax">Add a repository</strong> on any dashboard imports from GitHub or any https git server, with full history. Its default branch becomes
					trunk's <C>main</C>. For a private repository, give a read token: it's used for that one clone and never stored. From the API:
				</P>
				<Code>{`curl -X POST https://hivegit.dev/api/repos/import -H "authorization: Bearer $HIVE_TOKEN" \\
  -H 'content-type: application/json' -d '{"url":"https://github.com/dtolnay/itoa"}'`}</Code>
				<P>
					Then open <strong className="text-wax">Checks & settings</strong> and run the checks on trunk, so you know Hive can build and test it before agents start.
				</P>
				<H2 id="detected">What Hive runs</H2>
				<P>Without any configuration, Hive detects the usual commands:</P>
				<Table
					head={["Found", "Setup", "Checks"]}
					rows={[
						[<C>package.json</C>, "npm ci (or pnpm, yarn from the lockfile)", "its typecheck, build and test scripts"],
						[<C>Cargo.toml</C>, "cargo fetch", "cargo build --all-targets, cargo test"],
						[<C>pyproject.toml</C>, "a virtualenv with the project and pytest", "pytest"],
						[<C>go.mod</C>, "go mod download", "go vet, go build, go test"],
					]}
				/>
				<H2 id="hive-json">hive.json</H2>
				<P>
					To say exactly, add a <C>hive.json</C> at the repository's root. <C>setup</C> and <C>checks</C> each replace what was detected; setup re-runs only when the files it depends
					on change.
				</P>
				<Code lang="json">{`{
  "setup": ["make deps"],
  "checks": { "test": "make test", "lint": "make lint", "format": "make fmt-check" },
  "security": true
}`}</Code>
				<P>
					The same plan runs everywhere: agents run it in their own container and see exactly what the merge queue will run. A broken <C>hive.json</C> shows up as a failing check.
				</P>
				<H2 id="settings">Settings</H2>
				<Table
					head={["Setting", "Default", ""]}
					rows={[
						[<C>security</C>, "off", "Run the security scan on every batch (or set it in hive.json)"],
						[<C>decider</C>, <C>clef</C>, <>Who lands changes: Clef, on evidence plus a model review, or <C>evidence</C>, the checks alone</>],
						[<C>batchMax</C>, "16", "Changes stacked and checked together; a failing batch is split to find the culprit"],
					]}
				/>
			</>
		),
	},
	{
		slug: "security",
		title: "Security scan",
		group: "Use",
		summary: "Changes that introduce a secret, a vulnerable dependency or a risky pattern are sent back.",
		body: () => (
			<>
				<P>
					Turn it on in <strong className="text-wax">Checks & settings</strong>, or with <C>"security": true</C> in <C>hive.json</C>. Every batch then runs three scanners inside the
					merge container:
				</P>
				<List>
					<li>
						<strong className="text-wax">gitleaks</strong> for secrets;
					</li>
					<li>
						<strong className="text-wax">osv-scanner</strong> for dependencies with known vulnerabilities, from lockfiles;
					</li>
					<li>
						<strong className="text-wax">Semgrep</strong> for risky code, with its default rules.
					</li>
				</List>
				<H2 id="diffed">Compared with trunk</H2>
				<P>Findings are compared with trunk's, so an existing codebase isn't frozen by its history:</P>
				<List>
					<li>a finding the change introduces fails it, like a failing test, and the batch search isolates it;</li>
					<li>findings already on trunk don't block anyone;</li>
					<li>findings the change resolves are listed, which is how a security fix shows its work.</li>
				</List>
				<P>
					Findings are fingerprinted by tool, rule, file and the offending text (dependencies by advisory and package), so moving code doesn't create new ones and bumping to a
					version that still has the advisory doesn't hide it.
				</P>
				<H2 id="sandbox">The sandbox</H2>
				<P>
					Agents run commands a model wrote, so their containers start with the internet off. Every request goes through a gateway that allows only package registries and the
					agent's own fork, and adds a ten-minute, repository-scoped credential on the way out. No credential ever enters a container.
				</P>
			</>
		),
	},
	{
		slug: "plans",
		title: "Plans",
		group: "Use",
		summary: "Big goals become sub-goals that many agents work on in parallel.",
		body: () => (
			<>
				<P>
					A goal like “fix the security issues” or “port this service to Rust” is too big for one agent. Choose <strong className="text-wax">Plan it first</strong> when creating it
					(or <C>hive_plan</C> over MCP):
				</P>
				<List ordered>
					<li>A planner model reads trunk and Hive's code graph: files, symbols, and who references what.</li>
					<li>It proposes sub-goals with dependencies. Each is one coherent change that keeps the checks green and names the test that proves it.</li>
					<li>Hive starts an agent on every sub-goal whose dependencies have landed, up to the parallelism you set, and starts the next as each lands.</li>
				</List>
				<P>The dashboard draws the plan as a live dependency graph. The parent goal is achieved when every sub-goal has landed.</P>
				<Code>{`curl -X POST https://hivegit.dev/api/repos/shop/goals/g-…/plan -H "authorization: Bearer $HIVE_TOKEN" \\
  -H 'content-type: application/json' -d '{"maxParallel":4}'`}</Code>
			</>
		),
	},
	{
		slug: "api",
		title: "API reference",
		group: "Reference",
		summary: "Everything the dashboard, MCP server and CLI use. Reads are public; writes need the token.",
		body: () => (
			<>
				<P>
					Send <C>Authorization: Bearer &lt;HIVE_TOKEN&gt;</C> with every write. Bodies are JSON.
				</P>
				<Table
					head={["Method", "Path", ""]}
					rows={API.map(([m, p, d]) => [<C>{m}</C>, <C>{p}</C>, d])}
				/>
			</>
		),
	},
];

const API: [string, string, string][] = [
	["POST", "/api/repos", "Create a repository (trunk and ledger)"],
	["POST", "/api/repos/import", "Import: url, optional name, branch, token (private repositories; never stored)"],
	["GET", "/api/repos/:repo", "Snapshot: goals, changes, intents, queue, decisions, agents"],
	["GET", "/api/repos/:repo/trunk", "Trunk log with parsed trailers"],
	["GET", "/api/repos/:repo/index", "Semantic index status"],
	["GET", "/api/repos/:repo/stats", "Landings per minute, queue wait, batch sizes, latencies"],
	["POST", "/api/repos/:repo/clone", "One-hour clone URL (target: ledger for the ledger)"],
	["POST", "/api/repos/:repo/checks", "Run the checks (and security scan) on trunk"],
	["POST", "/api/repos/:repo/settings", "decider, batchMax (1–256), security"],
	["POST", "/api/repos/:repo/goals", "Create a goal"],
	["POST", "/api/repos/:repo/goals/:goal/assign", "Start a built-in agent (model optional)"],
	["POST", "/api/repos/:repo/goals/:goal/race", "Race several models (models)"],
	["POST", "/api/repos/:repo/goals/:goal/plan", "Plan into sub-goals (model, agentModel, maxParallel)"],
	["POST", "/api/repos/:repo/goals/:goal/claim", "An external agent claims a goal"],
	["POST", "/api/repos/:repo/changes/:change/intent", "Declare intent"],
	["POST", "/api/repos/:repo/changes/:change/submit", "Submit to the queue"],
	["GET", "/api/repos/:repo/changes/:change", "Intent, evidence, evaluations, decisions"],
	["POST", "/api/repos/:repo/changes/:change/decision", "A person lands or sends back an escalated change"],
	["POST", "/api/repos/:repo/changes/:change/restart", "Restart a built-in agent"],
	["POST", "/api/repos/:repo/changes/:change/abandon", "Archive a change and release its intent"],
	["POST", "/api/repos/:repo/races/:group/winner", "A person picks a race's winner"],
	["POST", "/api/repos/:repo/loadtest", "Simulated agents: agents, waveSize, sharedRate, brokenRate"],
	["GET", "/api/agents/:agent/transcript", "An agent's transcript"],
	["GET", "/api/hive/stats", "Totals across this deployment's repositories"],
	["WS", "/agents/coordinator/:repo", "Live events: a snapshot, then every change"],
	["POST", "/mcp", "MCP over streamable HTTP; read tools work without the token"],
];
