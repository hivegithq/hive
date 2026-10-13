import { describe, expect, it } from "vitest";
import { fingerprint, parseDiff } from "./diff.ts";

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,4 +10,5 @@ export function total(items: Item[]) {
 	let sum = 0;
-	for (const i of items) sum += i.price;
+	for (const i of items) sum += i.price * i.qty;
+	if (sum > 5000) sum -= 500;
 	return sum;
\\ No newline at end of file
diff --git a/test/cart.test.ts b/test/cart.test.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/test/cart.test.ts
@@ -0,0 +1,2 @@
+import { total } from "../src/cart";
+test("discount", () => {});
diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

describe("parseDiff", () => {
	const files = parseDiff(DIFF);

	it("splits files and counts lines", () => {
		expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
			["src/cart.ts", "modified", 2, 1],
			["test/cart.test.ts", "added", 2, 0],
			["new.ts", "renamed", 0, 0],
			["logo.png", "modified", 0, 0],
		]);
		expect(files[2].oldPath).toBe("old.ts");
		expect(files[3].binary).toBe(true);
	});

	it("numbers lines on both sides and keeps the hunk's context", () => {
		const h = files[0].hunks[0];
		expect(h.context).toBe("export function total(items: Item[]) {");
		expect(h.lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
			["ctx", 10, 10],
			["del", 11, null],
			["add", null, 11],
			["add", null, 12],
			["ctx", 12, 13],
		]);
	});
});

describe("fingerprint", () => {
	it("changes when the agent edits the file again, not when context moves", () => {
		const a = parseDiff(DIFF)[0];
		const same = parseDiff(DIFF)[0];
		expect(fingerprint(a)).toBe(fingerprint(same));
		const edited = parseDiff(DIFF.replace("sum -= 500;", "sum -= 250;"))[0];
		expect(fingerprint(edited)).not.toBe(fingerprint(a));
		const ctxOnly = parseDiff(DIFF.replace("\tlet sum = 0;", "\tlet sum = 1;"))[0];
		expect(fingerprint(ctxOnly)).toBe(fingerprint(a));
	});
});
