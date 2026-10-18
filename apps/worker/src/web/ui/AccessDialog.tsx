import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input } from "@cloudflare/kumo/components/input";
import { XIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";

type Answer = "retry" | null;
let pending: ((answer: Answer) => void) | null = null;
let show: (() => void) | null = null;

export function askForAccess(): Promise<Answer> {
	if (!show) return Promise.resolve(null);
	pending?.(null);
	return new Promise((resolve) => {
		pending = resolve;
		show?.();
	});
}

export const TOKEN_KEY = "hive-token";

export function AccessDialogHost() {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		show = () => setOpen(true);
		return () => {
			show = null;
		};
	}, []);
	const finish = (answer: Answer) => {
		setOpen(false);
		pending?.(answer);
		pending = null;
	};
	return (
		<Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && finish(null)}>
			<Dialog className="w-[min(520px,calc(100vw-2rem))] bg-[#141417] p-6 ring-1 ring-honey/35">
				<TokenBody finish={finish} />
			</Dialog>
		</Dialog.Root>
	);
}

function Header({ title }: { title: string }) {
	return (
		<div className="mb-3 flex items-start justify-between gap-4">
			<Dialog.Title className="font-display text-2xl font-semibold text-wax">{title}</Dialog.Title>
			<Dialog.Close aria-label="Close" render={(props) => <Button {...props} variant="ghost" shape="square" icon={XIcon} aria-label="Close" />} />
		</div>
	);
}

function TokenBody({ finish }: { finish: (answer: Answer) => void }) {
	const [token, setToken] = useState("");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!token.trim()) return;
		try {
			localStorage.setItem(TOKEN_KEY, token.trim());
		} catch {}
		setToken("");
		finish("retry");
	};
	return (
		<>
			<Header title="Owner access token" />
			<Dialog.Description className="text-kumo-subtle">
				Writes on a self-hosted Hive require its owner's token. <span className="font-mono text-kumo-default">pnpm self-host</span> saves it in{" "}
				<span className="font-mono text-kumo-default"> .hive-token</span>. The token is kept in this browser.
			</Dialog.Description>
			<form onSubmit={submit} className="mt-5 flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Input label="Access token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
				</div>
				<Button type="submit" variant="primary" disabled={!token.trim()}>
					Save
				</Button>
			</form>
		</>
	);
}
