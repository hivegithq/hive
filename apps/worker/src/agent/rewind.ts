// Rewinding an agent: take an earlier attempt's conversation up to step N, and the edits it made on
// the way, so a new attempt can carry on from there, differently. A "step" is one assistant turn and
// the tool results that answered it.

type Part = { type: string; toolCallId?: string; toolName?: string; input?: unknown; text?: string; output?: { type?: string; value?: unknown } };
export interface Msg {
	role: string;
	content: string | Part[];
}

export type Replay =
	| { tool: "write_file"; input: { path: string; content: string } }
	| { tool: "edit_file"; input: { path: string; oldText: string; newText: string } }
	| { tool: "declare_intent"; input: { summary: string; paths: string[]; symbols: { path: string; name: string }[] } };

export interface StepInfo {
	step: number; // 1-based
	calls: string[]; // tool names, with the file for edits
	said: string; // what the model said, shortened
	edits: number; // file changes made in this step
}

const REPLAYED = new Set(["write_file", "edit_file", "declare_intent"]);
const parts = (m: Msg): Part[] => (Array.isArray(m.content) ? m.content : []);

const failed = (result: Part | undefined) => {
	const v = result?.output?.value as { ok?: boolean; error?: unknown } | string | undefined;
	return typeof v === "object" && v !== null && (v.ok === false || v.error !== undefined);
};

// Indices of the assistant messages, which are the steps.
const stepIndices = (messages: Msg[]) => messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));

export function steps(messages: Msg[]): StepInfo[] {
	return stepIndices(messages).map((idx, n) => {
		const calls = parts(messages[idx]).filter((p) => p.type === "tool-call");
		const results = new Map(parts(messages[idx + 1] ?? { role: "", content: [] }).filter((p) => p.type === "tool-result").map((p) => [p.toolCallId, p]));
		const said = parts(messages[idx])
			.filter((p) => p.type === "text" || p.type === "reasoning")
			.map((p) => p.text ?? "")
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const input = (c: Part) => c.input as { path?: string } | undefined;
		return {
			step: n + 1,
			calls: calls.map((c) => (c.toolName === "write_file" || c.toolName === "edit_file" ? `${c.toolName} ${input(c)?.path ?? ""}` : (c.toolName ?? "?"))),
			said: said.slice(0, 160),
			edits: calls.filter((c) => (c.toolName === "write_file" || c.toolName === "edit_file") && !failed(results.get(c.toolCallId))).length,
		};
	});
}

// The conversation through step `step`, and what to redo in a fresh workspace to match it.
export function rewind(messages: Msg[], step: number): { kept: Msg[]; replay: Replay[]; total: number } {
	const idx = stepIndices(messages);
	if (step < 0 || step > idx.length) throw new Error(`step ${step} is out of range (the attempt has ${idx.length} step${idx.length === 1 ? "" : "s"})`);
	// Step 0 keeps just the opening brief. Otherwise through the assistant turn and its tool results.
	const end = step === 0 ? (idx[0] ?? messages.length) : idx[step - 1] + (messages[idx[step - 1] + 1]?.role === "tool" ? 2 : 1);
	const kept = messages.slice(0, end);
	const replay: Replay[] = [];
	for (let i = 0; i < kept.length; i++) {
		if (kept[i].role !== "assistant") continue;
		const results = new Map(parts(kept[i + 1] ?? { role: "", content: [] }).filter((p) => p.type === "tool-result").map((p) => [p.toolCallId, p]));
		for (const call of parts(kept[i]).filter((p) => p.type === "tool-call" && REPLAYED.has(p.toolName ?? ""))) {
			if (failed(results.get(call.toolCallId))) continue;
			replay.push({ tool: call.toolName, input: call.input } as Replay);
		}
	}
	return { kept, replay, total: idx.length };
}
