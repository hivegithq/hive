// A unified diff (git diff output) as files, hunks and numbered lines, for the diff view.

export interface DiffLine {
	type: "add" | "del" | "ctx";
	text: string;
	oldNo: number | null;
	newNo: number | null;
}

export interface DiffHunk {
	header: string;
	context: string; // the function or class git names after @@ … @@
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath: string | null; // set when renamed
	status: "added" | "deleted" | "modified" | "renamed";
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);

export function parseDiff(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | null = null;
	let hunk: DiffHunk | null = null;
	let oldNo = 0;
	let newNo = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
			file = { path: unquote(m?.[2] ?? line.slice(11)), oldPath: null, status: "modified", binary: false, additions: 0, deletions: 0, hunks: [] };
			files.push(file);
			hunk = null;
			continue;
		}
		if (!file) continue;
		if (!hunk) {
			if (line.startsWith("new file mode")) file.status = "added";
			else if (line.startsWith("deleted file mode")) file.status = "deleted";
			else if (line.startsWith("rename from ")) {
				file.status = "renamed";
				file.oldPath = unquote(line.slice(12));
			} else if (line.startsWith("rename to ")) file.path = unquote(line.slice(10));
			else if (line.startsWith("Binary files ")) file.binary = true;
		}
		const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
		if (h) {
			oldNo = Number(h[1]);
			newNo = Number(h[2]);
			hunk = { header: line, context: h[3].trim(), lines: [] };
			file.hunks.push(hunk);
			continue;
		}
		if (!hunk) continue;
		if (line.startsWith("+")) {
			hunk.lines.push({ type: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
			file.additions++;
		} else if (line.startsWith("-")) {
			hunk.lines.push({ type: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
			file.deletions++;
		} else if (line.startsWith(" ")) {
			hunk.lines.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
		}
		// "\ No newline at end of file" and anything else is not a line of the file.
	}
	return files;
}

// A short fingerprint of what a file's diff says, so a "seen" mark can clear itself when the
// agent edits the file again.
export function fingerprint(file: DiffFile): string {
	let h = 5381;
	for (const hunk of file.hunks) for (const l of hunk.lines) if (l.type !== "ctx") for (let i = 0; i < l.text.length; i++) h = ((h * 33) ^ l.text.charCodeAt(i)) >>> 0;
	return `${file.additions}.${file.deletions}.${h.toString(36)}`;
}
