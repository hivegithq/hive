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
	{ title: "Retry from step N: carry on from an earlier step of an attempt, with its edits redone", version: "1.7.0", from: "Delta" },
	{ title: "Context window breakdown: where an agent's tokens went, per step", version: "1.7.0", from: "Delta" },
	{ title: "A fixing pass: an agent resolves a review's concerns on top of the attempt's work", version: "1.7.0", from: "Delta" },
	{ title: "Repository memory: what reviewers asked for is told to every new agent", version: "1.7.0", from: "Delta" },
	{ title: "A reviewer model per repository", version: "1.7.0", from: "Delta" },
	{ title: "Sign-in loads only when needed: about 145 KB less on every page", version: "1.7.0" },
	{ title: "Steer a working agent: tell it something and it reads it before its next step", version: "1.6.0", from: "Delta" },
	{ title: "Conversations visible: messages to and from an agent in its change", version: "1.6.0", from: "Delta" },
	{ title: "Files seen: mark files reviewed; the mark clears when the agent edits the file again", version: "1.6.0", from: "Delta" },
	{ title: "Recurring goals: nightly lint, weekly dependency updates, skipped while the last run is going", version: "1.6.0" },
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
		title: "A reviewer that fixes",
		what: "A review agent works on a copy of the change and pushes fixes (with Approve / Request changes), instead of only writing a review.",
		progress: 70,
		have: "A fixing pass on request (resolves the review's concerns and comments on top of the attempt). Missing: running it automatically when a review raises concerns.",
		from: "Delta",
	},
	{
		title: "Agent roles in plans: scouts, workers, reviewers",
		what: "Planned goals use cheap read-only scouts to explore, workers to write, and reviewers to check, each with its own model.",
		progress: 45,
		have: "The planner explores like a scout; workers take models in turn; a reviewer model per repository and a fixing pass. Missing: read-only scouts per sub-goal.",
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
		what: "Plans that route questions to the agent that owns the code (“ask whoever holds Cart.total”), and agents that reach for each other without a person in between.",
		progress: 65,
		have: "Messages to and from an agent are shown in its change, and people can message a working agent. Intents say who is touching which symbols.",
		from: "Delta",
	},
	{
		title: "Bring your own model provider",
		what: "Agents on Anthropic, OpenAI or any compatible API (through AI Gateway), next to Workers AI, with spend tracked the same way.",
		progress: 0,
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
		progress: 60,
		have: "Review comments and send-backs become lessons every new agent is told, which you can pause or remove. Missing: lessons from decisions and bounce-then-fixed pairs.",
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
];
