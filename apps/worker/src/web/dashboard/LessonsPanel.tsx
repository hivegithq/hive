import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { BrainIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { api, type Lesson } from "../api.ts";

const SOURCE: Record<string, string> = { review: "from a review comment", "send-back": "from a send-back", manual: "added by hand" };

// What reviewers have asked for, remembered: every new agent on this repository is told these.
// Review comments and send-back notes are added automatically; pause one that's wrong.
export function LessonsPanel({ repo, canWrite }: { repo: string; canWrite: boolean }) {
	const [lessons, setLessons] = useState<Lesson[] | null>(null);
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api.lessons(repo).then(setLessons, (e) => setError(e.message));
	}, [repo]);

	const add = async (e: FormEvent) => {
		e.preventDefault();
		try {
			setLessons(await api.addLesson(repo, text.trim()));
			setText("");
		} catch (err) {
			setError((err as Error).message);
		}
	};

	if (!lessons || (lessons.length === 0 && !canWrite)) return null;
	return (
		<section className="space-y-3">
			<h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-honey">
				<BrainIcon size={16} /> What agents are told
			</h3>
			<p className="text-sm text-kumo-subtle">What reviewers have asked for before. Every new agent on {repo} reads these, so the same lesson isn't learned twice.</p>
			{lessons.length === 0 && <p className="text-sm text-kumo-subtle">Nothing yet. Review comments and send-back notes are remembered here automatically.</p>}
			<ul className="space-y-1.5">
				{lessons.slice(0, 12).map((l) => (
					<li key={l.id} className={`cut-sm bg-black/30 px-3 py-2 text-sm ring-1 ring-white/5 ${l.active ? "" : "opacity-50"}`}>
						<p className="text-kumo-default">{l.text}</p>
						<p className="mt-0.5 flex items-center gap-3 text-xs text-kumo-subtle">
							{SOURCE[l.source] ?? l.source}
							{canWrite && (
								<>
									<button type="button" className="hover:text-honey" onClick={async () => setLessons(await api.setLesson(repo, l.id, { active: !l.active }))}>
										{l.active ? "Pause" : "Resume"}
									</button>
									<button type="button" className="hover:text-alarm" onClick={async () => setLessons(await api.setLesson(repo, l.id, { remove: true }))}>
										Remove
									</button>
								</>
							)}
						</p>
					</li>
				))}
			</ul>
			{canWrite && (
				<form onSubmit={add} className="flex items-end gap-2">
					<div className="min-w-0 flex-1">
						<Input label="Teach every agent" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name constants instead of repeating numbers" />
					</div>
					<Button type="submit" variant="secondary" disabled={text.trim().length < 8}>
						Add
					</Button>
				</form>
			)}
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
		</section>
	);
}
