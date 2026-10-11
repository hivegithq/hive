import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";

// Import a repository, or start an empty one, then open its dashboard. On the landing page and
// in the dashboard's import dialog.
export function RepoForm({ initial = "import" }: { initial?: "new" | "import" }) {
	const [mode, setMode] = useState<"new" | "import">(initial);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [branch, setBranch] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const repo =
				mode === "new"
					? (await api.openRepo(name)).name
					: (await api.importRepo({ url: url.trim(), name: name.trim() || undefined, branch: branch.trim() || undefined, token: token.trim() || undefined })).name;
			location.assign(`/r/${encodeURIComponent(repo)}`);
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	};
	return (
		<form onSubmit={submit}>
			<Tabs
				variant="segmented"
				value={mode}
				onValueChange={(v) => (setMode(v as "new" | "import"), setError(null))}
				tabs={[
					{ value: "import", label: "Import a repository" },
					{ value: "new", label: "Start an empty one" },
				]}
			/>
			<p className="mt-4 text-kumo-subtle">
				{mode === "import"
					? "Clone any repository from GitHub or another git server into a new hive. Its default branch becomes trunk's main. Writes need this deployment's access token."
					: "Creates the trunk and its ledger, then opens the dashboard. Push your code to it with git. Writes need this deployment's access token."}
			</p>
			<div className="mt-5 space-y-3">
				{mode === "import" && (
					<Input label="Repository URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" required />
				)}
				<Input
					label={mode === "import" ? "Name in Hive (optional)" : "Repository name"}
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={mode === "import" ? "taken from the URL" : "shop"}
					pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,40}"
					required={mode === "new"}
				/>
				{mode === "import" && (
					<div className="grid gap-3 sm:grid-cols-2">
						<Input label="Branch (optional)" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="its default branch" />
						<Input
							label="Access token (private repos)"
							type="password"
							autoComplete="off"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							description="Used for this one clone, never stored."
						/>
					</div>
				)}
			</div>
			{error && <p className="mt-3 text-sm text-kumo-danger">{error}</p>}
			<Button type="submit" variant="primary" loading={busy} className="mt-5">
				{mode === "import" ? "Import repository" : "Open repository"}
			</Button>
		</form>
	);
}
