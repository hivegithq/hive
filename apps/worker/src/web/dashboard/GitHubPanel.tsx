import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Switch } from "@cloudflare/kumo/components/switch";
import { ArrowsClockwiseIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { api, type GitHubStatus } from "../api.ts";

const ago = (t: number) => {
	const m = Math.round((Date.now() - t) / 60_000);
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// Landed work goes back to GitHub: trunk mirrored to a branch, a pull request per achieved goal,
// and optionally GitHub's new commits brought in through the merge queue.
export function GitHubPanel({ repo, canWrite }: { repo: string; canWrite: boolean }) {
	const [status, setStatus] = useState<GitHubStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [token, setToken] = useState("");
	const [remote, setRemote] = useState("");
	const [opts, setOpts] = useState({ mirror: true, prs: true, pull: false });

	useEffect(() => {
		api.github(repo).then(setStatus, (e) => setError(e.message));
	}, [repo]);

	const act = async (name: string, fn: () => Promise<GitHubStatus>) => {
		setBusy(name);
		setError(null);
		try {
			setStatus(await fn());
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	};

	const connect = (e: FormEvent) => {
		e.preventDefault();
		act("connect", () => api.connectGitHub(repo, { token: token.trim(), remote: remote.trim() || undefined, ...opts })).then(() => setToken(""));
	};

	return (
		<section className="space-y-4">
			<h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-honey">
				<GithubLogoIcon size={16} /> GitHub
			</h3>
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
			{!status ? null : !status.connected ? (
				canWrite ? (
					<form onSubmit={connect} className="space-y-3">
						<p className="text-sm text-kumo-subtle">
							Send what lands here back to GitHub. Use a fine-grained token for that one repository with Contents and Pull requests set to read and write. It's stored encrypted, and only
							Hive's egress gateway uses it; agents never see it.
						</p>
						<Input label="Repository" value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="owner/repo (default: where this was imported from)" />
						<Input label="Token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
						<Switch label="Mirror trunk to the hive/main branch" checked={opts.mirror} onCheckedChange={(v) => setOpts({ ...opts, mirror: v })} />
						<Switch label="Open a pull request for each goal that lands" checked={opts.prs} onCheckedChange={(v) => setOpts({ ...opts, prs: v })} />
						<Switch label="Bring GitHub's new commits in, through the merge queue" checked={opts.pull} onCheckedChange={(v) => setOpts({ ...opts, pull: v })} />
						<Button type="submit" variant="primary" loading={busy === "connect"} disabled={!token.trim()}>
							Connect GitHub
						</Button>
					</form>
				) : (
					<p className="text-sm text-kumo-subtle">Not connected to GitHub.</p>
				)
			) : (
				<div className="space-y-3">
					<p className="text-sm text-kumo-default">
						Connected to{" "}
						<a href={status.repoUrl} target="_blank" rel="noreferrer" className="text-honey hover:underline">
							{status.owner}/{status.repo}
						</a>
						{status.lastRun ? <span className="text-kumo-subtle">, last synced {ago(status.lastRun)}</span> : null}.
					</p>
					<Switch
						label={`Mirror trunk to ${status.branch}`}
						checked={status.mirror}
						disabled={!canWrite}
						onCheckedChange={(v) => act("opt", () => api.githubOptions(repo, { mirror: v }))}
					/>
					<Switch
						label={`A pull request against ${status.base} for each goal that lands`}
						checked={status.prs}
						disabled={!canWrite}
						onCheckedChange={(v) => act("opt", () => api.githubOptions(repo, { prs: v }))}
					/>
					<Switch
						label="Bring GitHub's new commits in, through the merge queue"
						checked={status.pull}
						disabled={!canWrite}
						onCheckedChange={(v) => act("opt", () => api.githubOptions(repo, { pull: v }))}
					/>
					{status.error && <p className="text-sm text-kumo-danger">{status.error}</p>}
					{status.pullRequests.length > 0 && (
						<ul className="space-y-1 text-sm">
							{status.pullRequests.slice(0, 8).map((p) => (
								<li key={p.goalId} className="flex gap-2">
									<span className="w-16 shrink-0 text-kumo-subtle">{p.state}</span>
									{p.url ? (
										<a href={p.url} target="_blank" rel="noreferrer" className="truncate text-honey hover:underline">
											#{p.number}
										</a>
									) : (
										<span className="truncate text-kumo-subtle">{p.reason}</span>
									)}
								</li>
							))}
						</ul>
					)}
					{canWrite && (
						<div className="flex gap-2">
							<Button size="sm" variant="secondary" icon={ArrowsClockwiseIcon} loading={busy === "sync"} onClick={() => act("sync", () => api.githubSync(repo))}>
								Sync now
							</Button>
							<Button size="sm" variant="ghost" loading={busy === "disconnect"} onClick={() => act("disconnect", () => api.githubDisconnect(repo))}>
								Disconnect
							</Button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
