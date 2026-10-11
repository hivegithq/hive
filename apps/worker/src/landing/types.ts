// Shapes shared by the merge box, the landing workflow and the batch logic. No runtime
// dependencies, so the batch logic can also run in the browser (the landing page's demo).

export interface StackEntry {
	changeId: string;
	fork: string; // Artifacts repo name, also used as the git remote name
}

export type Stacked =
	| { changeId: string; ok: true; prev: string; tip: string; files: string[]; unioned?: string[] } // unioned: additive conflicts resolved
	| { changeId: string; ok: false; conflicts: { path: string; excerpt: string }[] }
	| { changeId: string; ok: false; empty: true };

export interface StackResult {
	trunk: string;
	tip: string; // tip of the stack after every change that applied
	entries: Stacked[];
}

export type PushResult = { ok: true; commit: string } | { ok: false; reason: string };

export interface EvidenceRun {
	kind: "setup" | "typecheck" | "lint" | "build" | "test" | "check" | "security";
	command: string;
	ok: boolean;
	output: string;
}
