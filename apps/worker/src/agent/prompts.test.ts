import { describe, expect, it } from "vitest";
import { lessonsSection } from "./prompts.ts";

describe("lessonsSection", () => {
	it("is empty without lessons and lists them as things to follow", () => {
		expect(lessonsSection([])).toBe("");
		const s = lessonsSection(["Name constants instead of repeating numbers", "(src/cart.ts) Use >= for the boundary"]);
		expect(s).toContain("reviewers of this repository have asked for before");
		expect(s).toContain("- Name constants instead of repeating numbers");
		expect(s).toContain("- (src/cart.ts) Use >= for the boundary");
	});
});
