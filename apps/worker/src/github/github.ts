// The slice of GitHub's REST API Hive uses: issues for goals, and (with a token) pushing back.

export interface GitHubRepo {
	owner: string;
	repo: string;
}

// "owner/repo", "https://github.com/owner/repo(.git)", or "git@github.com:owner/repo.git".
export function parseGitHubRepo(input: string): GitHubRepo | null {
	const s = input.trim();
	const m =
		/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(s) ?? /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s);
	return m ? { owner: m[1], repo: m[2] } : null;
}

export interface Issue {
	number: number;
	title: string;
	body: string;
	url: string;
	labels: string[];
	comments: number;
}

export function selectIssues(issues: Issue[], opts: { excludeLabels?: string[]; skip?: Set<number>; limit?: number }): Issue[] {
	const exclude = new Set((opts.excludeLabels ?? []).map((l) => l.toLowerCase()));
	return issues
		.filter((i) => !opts.skip?.has(i.number))
		.filter((i) => !i.labels.some((l) => exclude.has(l.toLowerCase())))
		.slice(0, opts.limit ?? issues.length);
}

const headers = (token?: string): HeadersInit => ({
	accept: "application/vnd.github+json",
	"user-agent": "hive (hivegit.dev)",
	"x-github-api-version": "2022-11-28",
	...(token ? { authorization: `Bearer ${token}` } : {}),
});

async function gh<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } });
	if (!res.ok) {
		const body = await res.text();
		const hint = res.status === 403 && /rate limit/i.test(body) ? " (GitHub's rate limit for unauthenticated requests; pass a token)" : "";
		throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status}${hint} ${body.slice(0, 200)}`);
	}
	return (await res.json()) as T;
}

// Open issues (not pull requests), oldest first, optionally only those with all of `labels`.
export async function listOpenIssues(r: GitHubRepo, opts: { token?: string; labels?: string[]; max?: number } = {}): Promise<Issue[]> {
	const out: Issue[] = [];
	const max = opts.max ?? 500;
	for (let page = 1; out.length < max && page <= 10; page++) {
		const q = new URLSearchParams({ state: "open", per_page: "100", page: String(page), sort: "created", direction: "asc" });
		if (opts.labels?.length) q.set("labels", opts.labels.join(","));
		type Raw = { number: number; title: string; body: string | null; html_url: string; labels: ({ name: string } | string)[]; comments: number; pull_request?: unknown };
		const batch = await gh<Raw[]>(`/repos/${r.owner}/${r.repo}/issues?${q}`, opts.token);
		for (const i of batch) {
			if (i.pull_request) continue;
			out.push({
				number: i.number,
				title: i.title,
				body: i.body ?? "",
				url: i.html_url,
				labels: i.labels.map((l) => (typeof l === "string" ? l : l.name)),
				comments: i.comments,
			});
		}
		if (batch.length < 100) break;
	}
	return out.slice(0, max);
}

export function goalFromIssue(r: GitHubRepo, issue: Issue): { title: string; description: string; ref: string } {
	const ref = `${r.owner}/${r.repo}#${issue.number}`;
	const body = issue.body.length > 8000 ? `${issue.body.slice(0, 8000)}\n\n(cut short; read the rest on GitHub)` : issue.body;
	return {
		ref,
		title: `${issue.title} (#${issue.number})`,
		description: `From GitHub issue ${ref}: ${issue.url}\n${issue.labels.length ? `Labels: ${issue.labels.join(", ")}\n` : ""}\n${body}`.trim(),
	};
}

export { gh };
