import { describe, expect, it } from "vitest";
import { repoPath } from "./paths.ts";

describe("repoPath", () => {
	it("keeps ordinary relative paths", () => {
		expect(repoPath("src/a.ts")).toBe("src/a.ts");
		expect(repoPath("./src//a.ts")).toBe("src/a.ts");
	});
	it("strips the workspace prefix a model sometimes adds", () => {
		expect(repoPath("workspace/repo/test/x.test.ts")).toBe("test/x.test.ts");
		expect(repoPath("/workspace/repo/test/x.test.ts")).toBe("test/x.test.ts");
		expect(repoPath("/src/a.ts")).toBe("src/a.ts");
	});
	it("refuses paths that leave the repository", () => {
		expect(() => repoPath("../etc/passwd")).toThrow(/outside/);
		expect(() => repoPath("src/../../x")).toThrow(/outside/);
	});
});
