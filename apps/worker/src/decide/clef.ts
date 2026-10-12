// Typed client for @cf/cloudflare/clef-flash: give it a state and typed questions,
// get calibrated probabilities back. Hive uses it for every decision point.

export const CLEF_MODEL = "@cf/cloudflare/clef-flash";

export type ClefQuestion =
	| { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
	| { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
	| { type: "score"; instructions: unknown; criteria: unknown[] };

export type ClefAnswer =
	| { type: "noul"; noul: number }
	| { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
	| { type: "score"; score: number; legend: Record<string, unknown>; probabilities: Record<string, number>; confidence: number };

type AnswerFor<Q extends ClefQuestion> = Extract<ClefAnswer, { type: Q["type"] }>;

export interface ClefResult<Qs extends Record<string, ClefQuestion>> {
	model: string;
	answers: { [K in keyof Qs]: AnswerFor<Qs[K]> };
	usage: { input_tokens: number; output_tokens: number };
}

export interface AiRunner {
	run(model: string, inputs: unknown, options?: unknown): Promise<unknown>;
}

export async function askClef<const Qs extends Record<string, ClefQuestion>>(
	ai: AiRunner,
	state: unknown,
	questions: Qs,
	gateway?: { id: string },
): Promise<ClefResult<Qs>> {
	const result = await ai.run(CLEF_MODEL, { model: "clef-flash", state, questions }, gateway ? { gateway } : undefined);
	return result as ClefResult<Qs>;
}

// An AI binding that reports each call's token usage, for spend tracking.
export function metered(ai: AiRunner, record: (usage: { input_tokens: number; output_tokens: number }) => void): AiRunner {
	return {
		async run(model, inputs, options) {
			const result = await ai.run(model, inputs, options);
			const usage = (result as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
			if (usage) record({ input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 });
			return result;
		},
	};
}
