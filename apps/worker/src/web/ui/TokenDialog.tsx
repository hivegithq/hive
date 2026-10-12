import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input } from "@cloudflare/kumo/components/input";
import { XIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { ACCESS_URL } from "../links.ts";

// Shown when a change needs this deployment's access token. api.ts awaits askForToken(); the host
// below (mounted once in App) answers with what was entered, or null when dismissed.
type Ask = (token: string | null) => void;
let pending: Ask | null = null;
let show: ((open: boolean) => void) | null = null;

export function askForToken(): Promise<string | null> {
	if (!show) return Promise.resolve(window.prompt("This Hive needs its access token to make changes."));
	pending?.(null);
	return new Promise((resolve) => {
		pending = resolve;
		show?.(true);
	});
}


export function TokenDialogHost() {
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState("");
	useEffect(() => {
		show = (o) => (setToken(""), setOpen(o));
		return () => {
			show = null;
		};
	}, []);
	const finish = (value: string | null) => {
		setOpen(false);
		pending?.(value);
		pending = null;
	};
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (token.trim()) finish(token.trim());
	};
	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && finish(null)}>
			<Dialog className="w-[min(520px,calc(100vw-2rem))] bg-[#141417] p-6 ring-1 ring-honey/35">
				<div className="mb-3 flex items-start justify-between gap-4">
					<Dialog.Title className="font-display text-2xl font-semibold text-wax">This Hive is read-only for you</Dialog.Title>
					<Dialog.Close aria-label="Close" render={(props) => <Button {...props} variant="ghost" shape="square" icon={XIcon} aria-label="Close" />} />
				</div>
				<Dialog.Description className="text-kumo-subtle">
					Anyone can watch what happens here. Starting agents, importing repositories and changing settings need the owner's access token, because those
					run containers and models on their account.
				</Dialog.Description>
				<div className="mt-5 grid gap-2 sm:grid-cols-2">
					<a href="/docs/deploy" className="cut-sm block bg-honey/10 p-3 ring-1 ring-honey/30 transition hover:bg-honey/15">
						<span className="block font-display font-semibold text-wax">Run your own</span>
						<span className="text-sm text-kumo-subtle">Deploy Hive to your Cloudflare account with one command.</span>
					</a>
					<a href={ACCESS_URL} target="_blank" rel="noreferrer" className="cut-sm block bg-white/5 p-3 ring-1 ring-white/10 transition hover:bg-white/10">
						<span className="block font-display font-semibold text-wax">Request access</span>
						<span className="text-sm text-kumo-subtle">Ask for a token to try changes on hivegit.dev.</span>
					</a>
				</div>
				<form onSubmit={submit} className="mt-5 flex items-end gap-2">
					<div className="min-w-0 flex-1">
						<Input label="Have a token?" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste it here" />
					</div>
					<Button type="submit" variant="primary" disabled={!token.trim()}>
						Use token
					</Button>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
