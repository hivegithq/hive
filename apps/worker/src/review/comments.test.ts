import { describe, expect, it } from "vitest";
import { feedback, type ReviewComment } from "./comments.ts";

const c = (o: Partial<ReviewComment>): ReviewComment => ({
	id: "x",
	changeId: "c-1",
	path: null,
	line: null,
	side: "new",
	excerpt: null,
	body: "",
	author: "karan",
	createdAt: 0,
	sentAt: null,
	...o,
});

describe("review feedback", () => {
	it("groups by file, orders by line, and keeps the code it's about", () => {
		const text = feedback([
			c({ path: "src/checkout.ts", line: 21, excerpt: "const shipping = total > T ? 0 : FEE;", body: "Use >= so orders exactly at the threshold ship free." }),
			c({ body: "Add a test for the boundary." }),
			c({ path: "src/checkout.ts", line: 4, body: "Name this constant." }),
			c({ path: "README.md", line: 9, side: "old", body: "Keep this line." }),
		]);
		expect(text.split("\n")[0]).toBe("A reviewer left 4 comments on your change. Address each one, run the checks, and submit again.");
		expect(text).toContain("- Add a test for the boundary.");
		expect(text.indexOf("README.md:")).toBeLessThan(text.indexOf("src/checkout.ts:"));
		expect(text.indexOf("line 4")).toBeLessThan(text.indexOf("line 21"));
		expect(text).toContain("line 21: `const shipping = total > T ? 0 : FEE;`");
		expect(text).toContain("line 9 (removed)");
	});
});
