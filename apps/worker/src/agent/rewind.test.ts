import { describe, expect, it } from "vitest";
import { type Msg, rewind, steps } from "./rewind.ts";

const call = (id: string, toolName: string, input: unknown) => ({ type: "tool-call", toolCallId: id, toolName, input });
const result = (id: string, toolName: string, value: unknown) => ({ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value } });

const convo: Msg[] = [
	{ role: "user", content: "Begin." },
	{ role: "assistant", content: [{ type: "reasoning", text: "Look around first." }, call("1", "list_files", {})] },
	{ role: "tool", content: [result("1", "list_files", { exitCode: 0 })] },
	{ role: "assistant", content: [call("2", "declare_intent", { summary: "Add a test", paths: ["test/a.test.ts"], symbols: [] }), call("3", "write_file", { path: "test/a.test.ts", content: "x" })] },
	{ role: "tool", content: [result("2", "declare_intent", "declared"), result("3", "write_file", { ok: true })] },
	{ role: "assistant", content: [call("4", "edit_file", { path: "test/a.test.ts", oldText: "x", newText: "y" })] },
	{ role: "tool", content: [result("4", "edit_file", { ok: false, error: "oldText matched 0 times" })] },
	{ role: "assistant", content: [call("5", "edit_file", { path: "test/a.test.ts", oldText: "x", newText: "z" }), call("6", "run", { command: "npm test" })] },
	{ role: "tool", content: [result("5", "edit_file", { ok: true }), result("6", "run", { exitCode: 1 })] },
];

describe("rewind", () => {
	it("lists the steps with what each did", () => {
		const s = steps(convo);
		expect(s.map((x) => x.step)).toEqual([1, 2, 3, 4]);
		expect(s[0].said).toBe("Look around first.");
		expect(s[1].calls).toEqual(["declare_intent", "write_file test/a.test.ts"]);
		expect(s.map((x) => x.edits)).toEqual([0, 1, 0, 1]); // the failed edit doesn't count
	});

	it("keeps the conversation through a step, with its tool results, and replays only the edits that worked", () => {
		const r = rewind(convo, 2);
		expect(r.kept).toHaveLength(5);
		expect(r.kept.at(-1)?.role).toBe("tool");
		expect(r.replay.map((x) => x.tool)).toEqual(["declare_intent", "write_file"]);
		const all = rewind(convo, 4);
		expect(all.replay.map((x) => x.tool)).toEqual(["declare_intent", "write_file", "edit_file"]);
		expect((all.replay[2].input as { newText: string }).newText).toBe("z"); // not the failed edit
	});

	it("step 0 is just the opening brief, and out of range is an error", () => {
		expect(rewind(convo, 0).kept).toHaveLength(1);
		expect(rewind(convo, 0).replay).toEqual([]);
		expect(() => rewind(convo, 9)).toThrow(/out of range/);
	});
});
