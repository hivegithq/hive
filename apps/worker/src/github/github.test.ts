import { describe, expect, it } from "vitest";
import { goalFromIssue, type Issue, parseGitHubRepo, selectIssues } from "./github.ts";

const issue = (number: number, labels: string[] = []): Issue => ({ number, title: `Issue ${number}`, body: "Steps to reproduce", url: `https://github.com/o/r/issues/${number}`, labels, comments: 0 });

describe("github", () => {
	it("reads owner/repo from the usual spellings", () => {
		expect(parseGitHubRepo("cloudflare/cf")).toEqual({ owner: "cloudflare", repo: "cf" });
		expect(parseGitHubRepo("https://github.com/google/uuid")).toEqual({ owner: "google", repo: "uuid" });
		expect(parseGitHubRepo("https://github.com/google/uuid.git")).toEqual({ owner: "google", repo: "uuid" });
		expect(parseGitHubRepo("git@github.com:pypa/sampleproject.git")).toEqual({ owner: "pypa", repo: "sampleproject" });
		expect(parseGitHubRepo("https://gitlab.com/a/b")).toBeNull();
	});

	it("skips imported issues and excluded labels, then limits", () => {
		const all = [issue(1), issue(2, ["upstream"]), issue(3, ["Bug"]), issue(4), issue(5)];
		expect(selectIssues(all, { excludeLabels: ["Upstream"], skip: new Set([1]), limit: 2 }).map((i) => i.number)).toEqual([3, 4]);
	});

	it("turns an issue into a goal that links back", () => {
		const g = goalFromIssue({ owner: "o", repo: "r" }, issue(42, ["bug"]));
		expect(g.ref).toBe("o/r#42");
		expect(g.title).toBe("Issue 42 (#42)");
		expect(g.description).toContain("https://github.com/o/r/issues/42");
		expect(g.description).toContain("Labels: bug");
	});
});
