import { describe, expect, it } from "vitest";
import { contextBreakdown } from "./context.ts";
import type { Msg } from "./rewind.ts";

const call = (id: string, toolName: string, input: unknown) => ({ type: "tool-call", toolCallId: id, toolName, input });
const result = (id: string, toolName: string, value: unknown) => ({ type: "tool-result", toolCallId: id, toolName, output: { type: "json", value } });

describe("context breakdown", () => {
	const msgs: Msg[] = [
		{ role: "user", content: "x".repeat(400) },
		{ role: "assistant", content: [{ type: "reasoning", text: "y".repeat(80) }, call("1", "read_file", { path: "src/a.ts" })] },
		{ role: "tool", content: [result("1", "read_file", { output: "z".repeat(4000) })] },
		{ role: "assistant", content: [call("2", "run", { command: "npm test" })] },
		{ role: "tool", content: [result("2", "run", { output: "ok" })] },
	];

	it("grows by category as the conversation does", () => {
		const b = contextBreakdown(2000, msgs);
		expect(b.steps.map((s) => s.step)).toEqual([0, 1, 2]);
		expect(b.steps[0].tokens.system).toBe(500);
		expect(b.steps[0].tokens.briefing).toBe(100);
		expect(b.steps[1].tokens.results).toBeGreaterThan(1000); // the 4000-char file the model read
		expect(b.steps[2].total).toBeGreaterThan(b.steps[1].total);
		expect(b.windowEstimate).toBe(b.steps[2].total);
	});

	it("names the largest tool results", () => {
		const b = contextBreakdown(0, msgs);
		expect(b.biggest[0]).toMatchObject({ step: 1, tool: "read_file" });
		expect(b.biggest[0].tokens).toBeGreaterThan(b.biggest[1].tokens);
	});
});
