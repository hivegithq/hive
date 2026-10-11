import { describe, expect, it } from "vitest";
import { resolveAdditive } from "./union.ts";

const hunk = (ours: string[], base: string[], theirs: string[]) => ["<<<<<<< HEAD", ...ours, "||||||| parent", ...base, "=======", ...theirs, ">>>>>>> change"];

describe("resolveAdditive", () => {
	it("keeps both insertions, trunk's first", () => {
		const text = ["export const seed = 1;", ...hunk(["export const a = 1;"], [], ["export const b = 2;"]), ""].join("\n");
		expect(resolveAdditive(text)).toBe("export const seed = 1;\nexport const a = 1;\nexport const b = 2;\n");
	});

	it("resolves several additive hunks in one file", () => {
		const text = [...hunk(["a"], [], ["b"]), "mid", ...hunk(["c"], [""], ["d"])].join("\n");
		expect(resolveAdditive(text)).toBe("a\nb\nmid\nc\nd");
	});

	it("refuses when either side changed existing lines", () => {
		expect(resolveAdditive(hunk(["x = 2"], ["x = 1"], ["x = 3"]).join("\n"))).toBeNull();
	});

	it("refuses without a diff3 base section, and on malformed markers", () => {
		expect(resolveAdditive(["<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> c"].join("\n"))).toBeNull();
		expect(resolveAdditive(["<<<<<<< HEAD", "a", "||||||| p"].join("\n"))).toBeNull();
		expect(resolveAdditive("no conflicts here")).toBeNull();
	});
});
