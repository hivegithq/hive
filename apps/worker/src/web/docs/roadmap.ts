// What's next for Hive, with how far along each item is. Rendered at /docs/roadmap and kept in
// sync with docs/ROADMAP.md. "Delta" marks ideas borrowed from delta.dev (the Zed team's
// multiplayer environment for coding with agents).

export interface RoadmapItem {
	title: string;
	what: string;
	progress: number; // 0..100
	have?: string; // what exists today, when partly there
	from?: "Delta";
}

export const SHIPPED: { title: string; version: string; from?: "Delta" }[] = [
	{ title: "Review comments on the diff, sent to the agent", version: "1.5.0", from: "Delta" },
	{ title: "Try again with another model or guidance, told what the last attempt ran into", version: "1.5.0", from: "Delta" },
	{ title: "Why is this line here? (line → change, goal, intent, proof, decision)", version: "1.5.0", from: "Delta" },
	{ title: ".agents/prepare and .delta/prepare as setup", version: "1.5.0", from: "Delta" },
	{ title: "Agents that give up wait for a person instead of looking busy", version: "1.5.0" },
	{ title: "Email notifications; side-by-side race lanes; private imports through the gateway", version: "1.5.0" },
	{ title: "Diff view in the change drawer", version: "1.4.0" },
	{ title: "Cost tracking and budgets", version: "1.4.0" },
	{ title: "Model leaderboard per repository", version: "1.4.0" },
	{ title: "GitHub issues as goals", version: "1.4.0" },
	{ title: "Push back to GitHub: mirror, a pull request per goal, upstream sync", version: "1.4.0" },
	{ title: "Webhooks: Slack, Discord, signed JSON", version: "1.4.0" },
	{ title: "Dependency cache shared between boxes", version: "1.4.0" },
	{ title: "Tested changes land at a lower bar; no duplicate sub-goals", version: "1.4.0" },
];

export const NEXT: RoadmapItem[] = [
	{
		title: "Conversation branching: retry from step N",
		what: "Rewind an agent to an earlier step, with its workspace as it was then, and continue differently; keep both branches to compare.",
		progress: 40,
		have: "Try again starts a fresh attempt that knows what the last one ran into. Transcripts are kept per step.",
		from: "Delta",
	},
	{
		title: "A reviewer that fixes",
		what: "A review agent works on a copy of the change and pushes fixes (with Approve / Request changes), instead of only writing a review.",
		progress: 15,
		have: "A model review and Clef's decision on every change; review comments from people.",
		from: "Delta",
	},
	{
		title: "Agent roles in plans: scouts, workers, reviewers",
		what: "Planned goals use cheap read-only scouts to explore, workers to write, and reviewers to check, each with its own model.",
		progress: 20,
		have: "The planner and parallel workers, with models per plan.",
		from: "Delta",
	},
	{
		title: "Provenance graph",
		what: "One view of how the repository evolved: goals, plans, agents' attempts, landings, pull requests, with the conversations behind them.",
		progress: 30,
		have: "Why-is-this-line-here, the plan graph, trunk history with trailers, the ledger.",
		from: "Delta",
	},
	{
		title: "Agents talking across work",
		what: "Agent-to-agent messages visible in the dashboard, and plans that route questions to the agent that owns the code (“ask whoever holds Cart.total”).",
		progress: 40,
		have: "hive_message and agent inboxes; intents say who is touching which symbols.",
		from: "Delta",
	},
	{
		title: "Steer a working agent live",
		what: "Join an agent while it works: watch its steps stream, send a correction mid-run, pause or stop it.",
		progress: 30,
		have: "Comments reach a working agent's inbox; the activity ticker; restart and abandon.",
		from: "Delta",
	},
	{
		title: "Review progress: files seen",
		what: "Mark files seen while reviewing a change, cleared when the agent edits them again (3/17 reviewed).",
		progress: 0,
		from: "Delta",
	},
	{
		title: "Bring your own model provider",
		what: "Agents on Anthropic, OpenAI or any compatible API (through AI Gateway), next to Workers AI, with spend tracked the same way.",
		progress: 0,
		from: "Delta",
	},
	{
		title: "Context window breakdown",
		what: "Per agent step: how much went to the system prompt, history, tool output; where the tokens (and money) go.",
		progress: 20,
		have: "Tokens and cost per call and per change.",
		from: "Delta",
	},
	{
		title: "Watchers, mentions and read-only sharing",
		what: "Follow a repository or change, @mention a teammate on a change that needs them, share read-only links.",
		progress: 10,
		have: "Public read-only dashboards; sign-in with a waitlist; webhooks.",
		from: "Delta",
	},
	{
		title: "Repository-level memory",
		what: "Comments, decisions and lessons from earlier changes offered to new agents working on the same code.",
		progress: 15,
		have: "The ledger records every intent, review and decision; try again carries one attempt's lessons forward.",
		from: "Delta",
	},
	{
		title: "“Your repos” home page",
		what: "A signed-in home listing your repositories, what needs you, and spend.",
		progress: 0,
	},
	{
		title: "Personal API keys and MCP sign-in",
		what: "People let in from the waitlist use the CLI and MCP with their own keys and spend limits, not the owner's token.",
		progress: 10,
		have: "Clerk sign-in for the dashboard; budgets per goal.",
	},
	{
		title: "Recurring goals",
		what: "Goals that run on a schedule: nightly “fix new lint warnings”, weekly “update dependencies”.",
		progress: 0,
	},
	{
		title: "Lazy-load sign-in",
		what: "Load Clerk only when someone signs in, instead of 145 KB on every page.",
		progress: 0,
	},
];
