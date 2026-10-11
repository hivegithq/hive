// The security scan's summary (security.ts summarize()) read back into its parts, for display.

export interface Finding {
	tool: string;
	rule: string;
	where: string;
	message: string;
}

export function parseSecurity(output: string) {
	const introduced: Finding[] = [];
	const resolved: Finding[] = [];
	let unchanged = 0;
	let into: Finding[] | null = null;
	for (const line of output.split("\n")) {
		if (/new finding\(s\) this change introduces/.test(line)) into = introduced;
		else if (/on trunk that this change resolves/.test(line)) into = resolved;
		else if (/already on trunk, unchanged/.test(line)) {
			unchanged = Number(line.match(/(\d+)/)?.[1] ?? 0);
			into = null;
		} else if (/^Scanner notes/.test(line)) into = null;
		else if (into && line.startsWith("  ")) {
			const m = line.trim().match(/^(\S+) (\S+) at (\S+?): (.*)$/);
			if (m) into.push({ tool: m[1], rule: m[2], where: m[3], message: m[4] });
		}
	}
	return { introduced, resolved, unchanged };
}

