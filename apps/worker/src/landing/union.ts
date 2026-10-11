// Additive conflicts: both sides inserted lines at the same place and neither changed anything that
// was there (the diff3 base section is empty). Many agents appending to one registry, index or
// changelog conflict this way on every rebase, so a hot file would admit one change per batch.
// Keeping both insertions (trunk's first) is what a person would do; evidence still runs on the
// result, so a combination that doesn't build or pass tests is caught like any other failure.
//
// Returns the resolved text, or null if any hunk is not purely additive. Self-contained on purpose:
// its source is also shipped into the merge container (see UNION_SCRIPT).
export function resolveAdditive(text: string): string | null {
	const lines = text.split("\n");
	const out: string[] = [];
	let i = 0;
	let hunks = 0;
	while (i < lines.length) {
		if (!lines[i].startsWith("<<<<<<<")) {
			out.push(lines[i++]);
			continue;
		}
		const ours: string[] = [];
		const base: string[] = [];
		const theirs: string[] = [];
		let section = ours;
		let sawBase = false;
		i++;
		for (;;) {
			if (i >= lines.length) return null;
			const l = lines[i++];
			if (l.startsWith("|||||||")) {
				section = base;
				sawBase = true;
			} else if (l.startsWith("=======") && (section === base || (section === ours && !sawBase))) section = theirs;
			else if (l.startsWith(">>>>>>>") && section === theirs) break;
			else if (l.startsWith("<<<<<<<")) return null;
			else section.push(l);
		}
		// Without a base section we can't tell an insertion from an edit.
		if (!sawBase || base.some((l) => l.trim() !== "")) return null;
		out.push(...ours, ...theirs);
		hunks++;
	}
	return hunks > 0 ? out.join("\n") : null;
}

// node script: resolve each file given as an argument in place, or exit 1 touching nothing.
export const UNION_SCRIPT = `const fs = require("node:fs");
const resolveAdditive = ${resolveAdditive.toString()};
const files = process.argv.slice(2);
const resolved = files.map((f) => resolveAdditive(fs.readFileSync(f, "utf8")));
if (files.length === 0 || resolved.some((r) => r === null)) process.exit(1);
files.forEach((f, i) => fs.writeFileSync(f, resolved[i]));
`;
