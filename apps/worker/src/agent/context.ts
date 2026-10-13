// Where an agent's context window goes: the system prompt, what people and Hive said, the model's own
// reasoning and replies, the calls it made, and what the tools sent back. Sizes are estimates
// (characters / 4), cumulative at each step, since that is what the model reads again every step.

import type { Msg } from "./rewind.ts";

export const CATEGORIES = ["system", "briefing", "reasoning", "calls", "results"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ContextStep {
	step: number; // 0 = before the first reply
	tokens: Record<Category, number>;
	total: number;
}

export interface ContextBreakdown {
	steps: ContextStep[];
	biggest: { step: number; tool: string; tokens: number }[]; // the largest tool results, which are what to trim
	windowEstimate: number; // tokens at the last step
}

const t = (chars: number) => Math.ceil(chars / 4);
const size = (v: unknown) => (typeof v === "string" ? v.length : JSON.stringify(v ?? "").length);

type Part = { type: string; text?: string; toolName?: string; input?: unknown; output?: { value?: unknown } };

export function contextBreakdown(systemChars: number, messages: Msg[]): ContextBreakdown {
	const running: Record<Category, number> = { system: t(systemChars), briefing: 0, reasoning: 0, calls: 0, results: 0 };
	const snapshot = (step: number): ContextStep => ({ step, tokens: { ...running }, total: CATEGORIES.reduce((n, c) => n + running[c], 0) });
	const steps: ContextStep[] = [];
	const biggest: ContextBreakdown["biggest"] = [];
	let step = 0;
	for (const m of messages) {
		const parts: Part[] = Array.isArray(m.content) ? (m.content as Part[]) : [{ type: "text", text: m.content }];
		if (m.role === "user") {
			for (const p of parts) running.briefing += t(size(p.text));
			if (step === 0 && steps.length === 0) steps.push(snapshot(0));
		} else if (m.role === "assistant") {
			step++;
			for (const p of parts) {
				if (p.type === "tool-call") running.calls += t(size(p.input) + (p.toolName?.length ?? 0));
				else running.reasoning += t(size(p.text));
			}
			steps.push(snapshot(step));
		} else if (m.role === "tool") {
			for (const p of parts) {
				const n = t(size(p.output?.value ?? p.output));
				running.results += n;
				biggest.push({ step, tool: p.toolName ?? "?", tokens: n });
			}
			// The model reads these on its next turn: fold them into the step that asked for them.
			if (steps.length) steps[steps.length - 1] = snapshot(step);
		}
	}
	if (!steps.length) steps.push(snapshot(0));
	return { steps, biggest: biggest.sort((a, b) => b.tokens - a.tokens).slice(0, 5), windowEstimate: steps.at(-1)?.total ?? 0 };
}
