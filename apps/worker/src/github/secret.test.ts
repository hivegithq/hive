import { describe, expect, it } from "vitest";
import { open, seal } from "./secret.ts";

describe("secret", () => {
	it("round-trips with the same master and fails with another", async () => {
		const sealed = await seal("master-1", "ghp_example");
		expect(sealed.startsWith("v1.")).toBe(true);
		expect(sealed).not.toContain("ghp_example");
		expect(await open("master-1", sealed)).toBe("ghp_example");
		expect(await open("master-2", sealed)).toBeNull();
		expect(await open("master-1", "garbage")).toBeNull();
	});
});
