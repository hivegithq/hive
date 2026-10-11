import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";

// Every module an agent added must report ok(). A "broken" simulated agent fails this on purpose,
// so a landing batch has to find the culprit.
test("every agent module reports ok", async () => {
	const dir = new URL("../agents/", import.meta.url);
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
		const mod = await import(new URL(file, dir).href);
		assert.equal(mod.ok(), true, `${file} reports not ok`);
	}
});

test("shared notes still parse", async () => {
	const notes = await import("../shared/notes.ts");
	assert.equal(notes.seed, "seed");
});
