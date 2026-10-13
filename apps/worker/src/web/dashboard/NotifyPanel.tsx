import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { BellIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { api, type Hook } from "../api.ts";

const EVENT_LABEL: Record<string, string> = {
	"needs-you": "needs you",
	"goal-landed": "goal landed",
	"race-finished": "race finished",
	"trunk-failing": "trunk failing",
};

// Webhooks for the moments a person should know about. Slack and Discord URLs are posted to in
// their own format; anything else gets JSON signed with a secret shown once.
export function NotifyPanel({ repo, canWrite }: { repo: string; canWrite: boolean }) {
	const [hooks, setHooks] = useState<Hook[] | null>(null);
	const [url, setUrl] = useState("");
	const [secret, setSecret] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (canWrite) api.hooks(repo).then(setHooks, (e) => setError(e.message));
	}, [repo, canWrite]);

	const add = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const h = await api.addHook(repo, { url: url.trim() });
			setSecret(h.signingSecret);
			setUrl("");
			setHooks(await api.hooks(repo));
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	if (!canWrite) return null;
	return (
		<section className="space-y-3">
			<h3 className="flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-honey">
				<BellIcon size={16} /> Notifications
			</h3>
			<p className="text-sm text-kumo-subtle">A webhook is called when a change needs a person, a goal lands, a race finishes, or trunk starts failing.</p>
			{hooks?.map((h) => (
				<div key={h.id} className="cut-sm space-y-1 bg-black/30 p-3 text-sm ring-1 ring-white/5">
					<p className="flex items-center gap-2">
						<span className="truncate font-mono text-xs text-kumo-default">{h.url}</span>
						<span className="text-xs text-kumo-subtle">{h.format}</span>
					</p>
					<p className="text-xs text-kumo-subtle">
						{h.events.map((e) => EVENT_LABEL[e] ?? e).join(", ")}
						{" · "}
						{h.last ? (h.last.ok ? "last delivery ok" : `last delivery failed${h.last.status ? ` (${h.last.status})` : ""}`) : "not used yet"}
					</p>
					<div className="flex gap-2 pt-1">
						<Button
							size="sm"
							variant="secondary"
							onClick={async () => {
								const r = await api.testHook(repo, h.id).catch((e: Error) => ({ ok: false, error: e.message }) as Hook["last"]);
								setNote(r?.ok ? "Test delivered." : `Test failed: ${r?.error ?? "no response"}`);
								setHooks(await api.hooks(repo));
							}}
						>
							Send a test
						</Button>
						<Button size="sm" variant="ghost" onClick={async () => setHooks(await api.removeHook(repo, h.id))}>
							Remove
						</Button>
					</div>
				</div>
			))}
			{note && <p className="text-sm text-kumo-default">{note}</p>}
			<form onSubmit={add} className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Input label="Webhook URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/… or mailto:you@example.com" />
				</div>
				<Button type="submit" variant="secondary" loading={busy} disabled={!url.trim()}>
					Add
				</Button>
			</form>
			{secret && (
				<p className="text-sm text-kumo-default">
					Signing secret, shown once: <code className="break-all font-mono text-xs text-honey">{secret}</code>. Deliveries carry{" "}
					<code className="font-mono text-xs">X-Hive-Signature-256: sha256=HMAC(secret, body)</code>.
				</p>
			)}
			{error && <p className="text-sm text-kumo-danger">{error}</p>}
		</section>
	);
}
