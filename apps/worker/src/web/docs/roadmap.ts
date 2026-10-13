// What's next for Hive, with how far along each item is. Rendered at /docs/roadmap and kept in
// sync with docs/ROADMAP.md.

export interface RoadmapItem {
	title: string;
	what: string;
	progress: number; // 0..100
	have?: string; // what exists today, when partly there
}

export const SHIPPED: { title: string; version: string }[] = [
	{ title: "Agents ask whoever owns the code: ask_owner messages the agent working on it and answers from what landed there", version: "1.11.0" },
	{ title: "Scouts in plans: a cheap read-only agent briefs each sub-goal's worker; workers are told who built what they build on", version: "1.11.0" },
	{ title: "A reviewer that fixes: the reviewer model carries on from a copy of the change and resolves what it found", version: "1.10.0" },
	{ title: "Provenance graph: goals, every attempt, how each ended and the pull request, drawn", version: "1.10.0" },
	{ title: "Bring your own model provider: any CamelAI model (Anthropic, OpenAI, free OpenRouter ones) runs agents with Hive's tools", version: "1.9.0" },
	{ title: "History by goal: every attempt, how it ended, the pull request, the cost", version: "1.8.0" },
	{ title: "Automatic fixing pass (opt in): when Clef isn't sure and the review raised concerns", version: "1.8.0" },
	{ title: "Repositories home: every repository, busiest first, with what needs a person", version: "1.8.0" },
	{ title: "Retry from step N: carry on from an earlier step of an attempt, with its edits redone", version: "1.7.0" },
	{ title: "Context window breakdown: where an agent's tokens went, per step", version: "1.7.0" },
	{ title: "A fixing pass: an agent resolves a review's concerns on top of the attempt's work", version: "1.7.0" },
	{ title: "Repository memory: what reviewers asked for is told to every new agent", version: "1.7.0" },
	{ title: "A reviewer model per repository", version: "1.7.0" },
	{ title: "Sign-in loads only when needed: about 145 KB less on every page", version: "1.7.0" },
	{ title: "Steer a working agent: tell it something and it reads it before its next step", version: "1.6.0" },
	{ title: "Conversations visible: messages to and from an agent in its change", version: "1.6.0" },
	{ title: "Files seen: mark files reviewed; the mark clears when the agent edits the file again", version: "1.6.0" },
	{ title: "Recurring goals: nightly lint, weekly dependency updates, skipped while the last run is going", version: "1.6.0" },
	{ title: "Review comments on the diff, sent to the agent", version: "1.5.0" },
	{ title: "Try again with another model or guidance, told what the last attempt ran into", version: "1.5.0" },
	{ title: "Why is this line here? (line → change, goal, intent, proof, decision)", version: "1.5.0" },
	{ title: ".agents/prepare as setup", version: "1.5.0" },
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
		title: "Watchers, mentions and read-only sharing",
		what: "Follow a repository or change, @mention a teammate on a change that needs them, share read-only links.",
		progress: 10,
		have: "Public read-only dashboards; sign-in with a waitlist; webhooks.",
	},
	{
		title: "Repository-level memory",
		what: "Comments, decisions and lessons from earlier changes offered to new agents working on the same code.",
		progress: 60,
		have: "Review comments and send-backs become lessons every new agent is told, which you can pause or remove. Missing: lessons from decisions and bounce-then-fixed pairs.",
	},
	{
		title: "Personal API keys and MCP sign-in",
		what: "People let in from the waitlist use the CLI and MCP with their own keys and spend limits, not the owner's token.",
		progress: 10,
		have: "Clerk sign-in for the dashboard; budgets per goal.",
	},
];
