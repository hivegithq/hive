import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { CaretDownIcon, CaretRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { api } from "../api.ts";

// Open GitHub issues as goals, one each. Collapsed until asked for.
export function IssueImport({ repo }: { repo: string }) {
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState("");
	const [exclude, setExclude] = useState("");
	const [limit, setLimit] = useState("20");
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const Caret = open ? CaretDownIcon : CaretRightIcon;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			const r = await api.importIssues(repo, {
				source: source.trim() || undefined,
				excludeLabels: exclude
					.split(",")
					.map((l) => l.trim())
					.filter(Boolean),
				limit: Number(limit) || 20,
			});
			setResult(
				r.created.length
					? `${r.created.length} new goal${r.created.length === 1 ? "" : "s"} from ${r.source} (${r.open} open, ${r.alreadyImported} imported before). Start agents on them from the goal list or with hive_assign.`
					: `Nothing new: ${r.source} has ${r.open} open, ${r.alreadyImported} already imported.`,
			);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section>
			<button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm text-kumo-subtle hover:text-wax">
				<Caret size={12} />
				<GithubLogoIcon size={14} /> Import GitHub issues as goals
			</button>
			{open && (
				<form onSubmit={submit} className="mt-3 space-y-3">
					<Input label="Repository" value={source} onChange={(e) => setSource(e.target.value)} placeholder="owner/repo (default: where this was imported from)" />
					<Input label="Skip labels" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="upstream, question, wontfix" />
					<Input label="At most" type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(e.target.value)} />
					<Button type="submit" variant="secondary" loading={busy} className="w-full justify-center">
						Import issues
					</Button>
					{result && <p className="text-sm text-kumo-default">{result}</p>}
					{error && <p className="text-sm text-kumo-danger">{error}</p>}
				</form>
			)}
		</section>
	);
}
