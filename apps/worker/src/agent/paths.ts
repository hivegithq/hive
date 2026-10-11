// Paths from a model, made relative to the repository root. Models sometimes include the
// workspace they were told about ("/workspace/repo/src/a.ts", "workspace/repo/src/a.ts"), which
// would otherwise create a stray workspace/ directory in the commit. Anything that escapes the
// repository is refused.
export function repoPath(input: string): string {
	const p = input
		.trim()
		.replaceAll("\\", "/")
		.replace(/^\/?workspace\/repo(\/|$)/, "")
		.replace(/^\/+/, "");
	const parts: string[] = [];
	for (const seg of p.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (parts.length === 0) throw new Error(`${input} is outside the repository`);
			parts.pop();
		} else parts.push(seg);
	}
	return parts.join("/") || ".";
}
