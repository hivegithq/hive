import { Button } from "@cloudflare/kumo/components/button";
import { CaretDownIcon, CaretRightIcon, ChatCircleTextIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { Intent } from "../../domain/types.ts";
import { api, modelLabel, type ReviewComment } from "../api.ts";
import { type DiffFile, fingerprint, parseDiff } from "./diff.ts";

const BIG = 400; // lines; bigger files start collapsed

// Which files of a change a reviewer has looked at, kept in this browser. A mark clears when the
// agent changes that file again (its fingerprint differs).
function useSeen(repo: string, changeId: string) {
	const key = `hive-seen:${repo}:${changeId}`;
	const read = (): Record<string, string> => {
		try {
			return JSON.parse(localStorage.getItem(key) ?? "{}");
		} catch {
			return {};
		}
	};
	const [seen, setSeen] = useState<Record<string, string>>(read);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read when the change changes
	useEffect(() => setSeen(read()), [key]);
	const toggle = (path: string, print: string) => {
		const next = { ...seen };
		if (next[path] === print) delete next[path];
		else next[path] = print;
		setSeen(next);
		try {
			localStorage.setItem(key, JSON.stringify(next));
		} catch {}
	};
	return { isSeen: (path: string, print: string) => seen[path] === print, toggle };
}

// Commenting on lines: the comments on this change, and how to add one (absent when read-only).
export interface Review {
	comments: ReviewComment[];
	add?: (c: { path: string; line: number; side: "new" | "old"; excerpt: string; body: string }) => Promise<void>;
}

const SOURCE: Record<string, string> = {
	merge: "as checked by the merge queue",
	agent: "as submitted by the agent",
	cli: "as submitted from the CLI",
};

// What the change does to the code, file by file. Files and functions the agent declared in its
// intent are marked; files it touched without declaring them are flagged.
export function DiffView({ repo, changeId, intent, tick, review }: { repo: string; changeId: string; intent: Intent | null; tick: number; review?: Review }) {
	const [state, setState] = useState<{ files: DiffFile[]; source: string; truncated: boolean } | "none" | null>(null);
	useEffect(() => {
		api.diff(repo, changeId).then(
			(d) => setState({ files: parseDiff(d.diff), source: d.source, truncated: d.truncated }),
			() => setState("none"),
		);
	}, [repo, changeId, tick]);

	const seen = useSeen(repo, changeId);
	const declaredPaths = useMemo(() => new Set([...(intent?.paths ?? []), ...(intent?.symbols ?? []).map((s) => s.path)]), [intent]);
	const declaredNames = useMemo(() => (intent?.symbols ?? []).map((s) => s.name.split(".").at(-1) ?? s.name), [intent]);

	if (state === null) return <p className="text-sm text-kumo-subtle">Loading the diff</p>;
	if (state === "none")
		return <p className="text-sm text-kumo-subtle">No diff yet. It appears when the agent submits, and again when the merge queue checks the change.</p>;

	const reviewed = state.files.filter((f) => seen.isSeen(f.path, fingerprint(f))).length;
	const adds = state.files.reduce((n, f) => n + f.additions, 0);
	const dels = state.files.reduce((n, f) => n + f.deletions, 0);
	return (
		<div>
			<p className="mb-3 text-sm text-kumo-subtle">
				{state.files.length} {state.files.length === 1 ? "file" : "files"}, <span className="text-honey">+{adds}</span> <span className="text-alarm">−{dels}</span>,{" "}
				{SOURCE[state.source] ?? state.source}.{state.truncated && " Cut short: the full change is in its fork."}
				{state.files.length > 1 && <span className="ml-2 text-kumo-default">{reviewed} of {state.files.length} reviewed</span>}
			</p>
			<div className="space-y-3">
				{state.files.map((f) => (
					<FileDiff key={`${f.oldPath ?? ""}${f.path}`} file={f} declared={!intent || declaredPaths.has(f.path)} names={declaredNames} review={review} seen={seen.isSeen(f.path, fingerprint(f))} onSeen={() => seen.toggle(f.path, fingerprint(f))} />
				))}
			</div>
		</div>
	);
}

function FileDiff({
	file,
	declared,
	names,
	review,
	seen,
	onSeen,
}: {
	file: DiffFile;
	declared: boolean;
	names: string[];
	review?: Review;
	seen: boolean;
	onSeen: () => void;
}) {
	const size = file.hunks.reduce((n, h) => n + h.lines.length, 0);
	const [open, setOpen] = useState(size <= BIG);
	const [editing, setEditing] = useState<string | null>(null); // "new:21"
	const here = (review?.comments ?? []).filter((c) => c.path === file.path);
	const Caret = open ? CaretDownIcon : CaretRightIcon;
	return (
		<section className="overflow-hidden ring-1 ring-comb-line">
			<div className="flex items-center bg-comb/60">
			<button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-comb">
				<Caret size={12} className="shrink-0 text-kumo-subtle" />
				<span className="min-w-0 flex-1 truncate font-mono text-[13px] text-wax">
					{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
				</span>
				{file.status !== "modified" && <span className="shrink-0 text-xs text-kumo-subtle">{file.status}</span>}
				{!declared && (
					<span className="shrink-0 text-xs text-alarm" title="The agent changed this file without declaring it in its intent">
						not declared
					</span>
				)}
				<span className="shrink-0 tabular text-xs">
					<span className="text-honey">+{file.additions}</span> <span className="text-alarm">−{file.deletions}</span>
				</span>
			</button>
			<label className="flex shrink-0 cursor-pointer items-center gap-1.5 px-3 text-xs text-kumo-subtle hover:text-wax" title="Mark as reviewed; clears if the agent changes this file again">
				<input type="checkbox" checked={seen} onChange={onSeen} className="accent-[#fbad41]" />
				Seen
			</label>
			</div>
			{open &&
				(file.binary ? (
					<p className="px-3 py-2 text-xs text-kumo-subtle">Binary file.</p>
				) : (
					<div className="overflow-x-auto bg-black/40">
						<table className="w-full border-collapse font-mono text-[12px] leading-[1.55] [font-variant-ligatures:none]">
							<tbody>
								{file.hunks.map((h) => {
									const touches = names.find((n) => n && h.context.includes(n));
									return [
										<tr key={h.header} className="bg-steel/10 text-kumo-subtle">
											<td colSpan={3} className="px-3 py-1">
												{h.context ? <span className={touches ? "text-honey" : ""}>{h.context}</span> : <span className="opacity-60">{h.header}</span>}
												{touches && <span className="ml-2 text-[11px] text-honey/80">declared</span>}
											</td>
										</tr>,
										...h.lines.flatMap((l, i) => {
											const side: "new" | "old" = l.type === "del" ? "old" : "new";
											const line = (side === "old" ? l.oldNo : l.newNo) ?? 0;
											const key = `${side}:${line}`;
											const notes = here.filter((c) => c.line === line && c.side === side);
											const canAdd = !!review?.add;
											return [
											<tr
												// biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond position
												key={`${h.header}:${i}`}
												className={`group ${l.type === "add" ? "bg-honey/[0.08]" : l.type === "del" ? "bg-alarm/[0.09]" : ""}`}
											>
												<td className="w-10 select-none px-2 text-right text-white/25">{l.oldNo ?? ""}</td>
												<td className="w-10 select-none px-2 text-right text-white/25">
													{canAdd ? (
														<button type="button" onClick={() => setEditing(editing === key ? null : key)} className="w-full text-right hover:text-honey" title="Comment on this line">
															<span className="group-hover:hidden">{l.newNo ?? (l.oldNo ? "·" : "")}</span>
															<ChatCircleTextIcon size={12} className="ml-auto hidden text-honey group-hover:block" />
														</button>
													) : (
														(l.newNo ?? "")
													)}
												</td>
												<td className="whitespace-pre pr-4">
													<span className={`mr-2 select-none ${l.type === "add" ? "text-honey" : l.type === "del" ? "text-alarm" : "text-white/20"}`}>
														{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
													</span>
													<span className={l.type === "ctx" ? "text-kumo-subtle" : "text-wax"}>{l.text}</span>
												</td>
											</tr>,
											...notes.map((c) => (
												<tr key={c.id}>
													<td colSpan={3} className="px-3 py-1.5">
														<CommentNote comment={c} />
													</td>
												</tr>
											)),
											editing === key && review?.add ? (
												<tr key={`${key}:edit`}>
													<td colSpan={3} className="px-3 py-2">
														<CommentEditor
															onCancel={() => setEditing(null)}
															onSave={async (body) => {
																await review.add?.({ path: file.path, line, side, excerpt: l.text, body });
																setEditing(null);
															}}
														/>
													</td>
												</tr>
											) : null,
										];
										}),
									];
								})}
							</tbody>
						</table>
					</div>
				))}
		</section>
	);
}

// A race lane's diff, optionally next to another lane's: the same goal, solved differently.
export function RaceDiff(props: {
	repo: string;
	changeId: string;
	group: string;
	intent: Intent | null;
	tick: number;
	wide: boolean;
	setWide: (w: boolean) => void;
	review?: Review;
}) {
	const [lanes, setLanes] = useState<{ id: string; model: string; index: number }[]>([]);
	const [other, setOther] = useState<string | null>(null);
	useEffect(() => {
		api.snapshot(props.repo).then(
			(s) =>
				setLanes(
					s.changes
						.filter((c) => c.race?.group === props.group && c.id !== props.changeId)
						.map((c) => ({ id: c.id, model: c.model, index: c.race?.index ?? 0 }))
						.sort((a, b) => a.index - b.index),
				),
			() => {},
		);
	}, [props.repo, props.group, props.changeId]);
	const pick = (id: string | null) => {
		setOther(id);
		if (id) props.setWide(true);
	};
	return (
		<div>
			{lanes.length > 0 && (
				<p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-kumo-subtle">
					Compare with
					{lanes.map((l) => (
						<button
							key={l.id}
							type="button"
							onClick={() => pick(other === l.id ? null : l.id)}
							className={`cut-sm px-2 py-0.5 text-xs ring-1 ${other === l.id ? "bg-honey/15 text-wax ring-honey/50" : "ring-white/10 hover:text-wax"}`}
						>
							lane {l.index + 1}: {modelLabel(l.model)}
						</button>
					))}
				</p>
			)}
			{other ? (
				<div className="grid gap-4 lg:grid-cols-2">
					<div className="min-w-0">
						<p className="mb-2 text-xs text-honey">This change</p>
						<DiffView repo={props.repo} changeId={props.changeId} intent={props.intent} tick={props.tick} review={props.review} />
					</div>
					<div className="min-w-0">
						<p className="mb-2 text-xs text-honey">{lanes.find((l) => l.id === other) ? `Lane ${(lanes.find((l) => l.id === other)?.index ?? 0) + 1}` : other}</p>
						<DiffView repo={props.repo} changeId={other} intent={null} tick={props.tick} />
					</div>
				</div>
			) : (
				<DiffView repo={props.repo} changeId={props.changeId} intent={props.intent} tick={props.tick} review={props.review} />
			)}
		</div>
	);
}

function CommentNote({ comment }: { comment: ReviewComment }) {
	return (
		<div className="cut-sm whitespace-normal bg-[#18181c] px-3 py-2 font-sans text-[13px] ring-1 ring-honey/25">
			<span className="text-xs text-kumo-subtle">
				{comment.author}
				{comment.sentAt ? " · sent to the agent" : " · not sent yet"}
			</span>
			<p className="mt-0.5 text-kumo-default">{comment.body}</p>
		</div>
	);
}

export function CommentEditor({ onSave, onCancel, placeholder }: { onSave: (body: string) => Promise<void>; onCancel?: () => void; placeholder?: string }) {
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!body.trim()) return;
		setBusy(true);
		try {
			await onSave(body.trim());
			setBody("");
		} finally {
			setBusy(false);
		}
	};
	return (
		<form onSubmit={submit} className="space-y-2 font-sans">
			<textarea
				// biome-ignore lint/a11y/noAutofocus: opened on purpose by clicking a line
				autoFocus={!!onCancel}
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={2}
				placeholder={placeholder ?? "What should the agent change here?"}
				className="w-full resize-y rounded bg-black/40 px-3 py-2 text-[13px] text-wax ring-1 ring-white/10 focus:outline-none focus:ring-honey/50"
			/>
			<div className="flex gap-2">
				<Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!body.trim()}>
					Add comment
				</Button>
				{onCancel && (
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</form>
	);
}
