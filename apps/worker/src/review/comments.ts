// Review comments: a person's notes on lines of a change's diff (or on the change as a whole),
// delivered to the agent together as one round of feedback.

export interface ReviewComment {
	id: string;
	changeId: string;
	path: string | null; // null: about the change as a whole
	line: number | null;
	side: "new" | "old";
	excerpt: string | null; // the line it's on, so the agent sees what the comment means
	body: string;
	author: string;
	createdAt: number;
	sentAt: number | null;
}

// One message for the agent, grouped by file, in line order.
export function feedback(comments: ReviewComment[]): string {
	const general = comments.filter((c) => !c.path);
	const byFile = new Map<string, ReviewComment[]>();
	for (const c of comments.filter((c) => c.path)) byFile.set(c.path!, [...(byFile.get(c.path!) ?? []), c]);
	const lines = [`A reviewer left ${comments.length} comment${comments.length === 1 ? "" : "s"} on your change. Address each one, run the checks, and submit again.`, ""];
	for (const c of general) lines.push(`- ${c.body}`);
	if (general.length) lines.push("");
	for (const [path, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`${path}:`);
		for (const c of list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
			const where = c.line ? `line ${c.line}${c.side === "old" ? " (removed)" : ""}` : "the file";
			lines.push(`  ${where}${c.excerpt ? `: \`${c.excerpt.trim().slice(0, 160)}\`` : ""}`, `    ${c.body}`);
		}
		lines.push("");
	}
	return lines.join("\n").trim();
}
