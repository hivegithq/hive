import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input } from "@cloudflare/kumo/components/input";
import { XIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { ACCESS, openSignIn, openWaitlist, SITE_URL, useAuthState } from "../clerk.ts";

// Shown when a change needs access this visitor doesn't have. api.ts awaits askForAccess(); the
// host below (mounted once in App) answers "retry" once the visitor can make the change (signed
// in, or gave a token on a self-hosted Hive), or null when they close it.
type Answer = "retry" | null;
let pending: ((a: Answer) => void) | null = null;
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
	const finish = (a: Answer) => {
		setOpen(false);
		pending?.(a);
		pending = null;
	};
	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && finish(null)}>
			<Dialog className="w-[min(520px,calc(100vw-2rem))] bg-[#141417] p-6 ring-1 ring-honey/35">
				{ACCESS === "clerk" ? <SignInBody open={open} finish={finish} /> : ACCESS === "elsewhere" ? <ElsewhereBody /> : <TokenBody finish={finish} />}
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

// hivegit.dev: sign in if you've been let in, otherwise join the waitlist.
function SignInBody({ open, finish }: { open: boolean; finish: (a: Answer) => void }) {
	const { signedIn } = useAuthState();
	// Signing in happens in Clerk's own modal; once it succeeds, carry on with the change.
	useEffect(() => {
		if (open && signedIn) finish("retry");
	}, [open, signedIn, finish]);
	return (
		<>
			<Header title="Sign in to make changes" />
			<Dialog.Description className="text-kumo-subtle">
				Anyone can watch what happens here. Starting agents, importing repositories and changing settings run containers and models, so they're open to people
				with access. Join the waitlist and you'll get an email when you're in.
			</Dialog.Description>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button variant="primary" onClick={() => openWaitlist().catch(() => {})}>
					Join the waitlist
				</Button>
				<Button variant="secondary" onClick={() => openSignIn().catch(() => {})}>
					I have access: sign in
				</Button>
			</div>
			<p className="mt-6 text-sm text-kumo-subtle">
				Or{" "}
				<a href="/docs/deploy" className="text-honey underline-offset-4 hover:underline">
					run your own Hive
				</a>{" "}
				on your Cloudflare account, with no waitlist.
			</p>
		</>
	);
}

// This deployment signs people in on its own domain (this is its workers.dev address).
function ElsewhereBody() {
	return (
		<>
			<Header title="Make changes on the main site" />
			<Dialog.Description className="text-kumo-subtle">Sign-in for this Hive lives on its own domain. The same repositories are there.</Dialog.Description>
			<div className="mt-6">
				<a href={`${SITE_URL}${location.pathname}`} className="cut-sm inline-block bg-honey px-4 py-2 font-medium text-night hover:bg-honey-deep">
					Open {SITE_URL.replace("https://", "")}
				</a>
			</div>
		</>
	);
}

// A self-hosted Hive without sign-in: its owner pastes the HIVE_TOKEN once.
function TokenBody({ finish }: { finish: (a: Answer) => void }) {
	const [token, setToken] = useState("");
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!token.trim()) return;
		try {
			localStorage.setItem(TOKEN_KEY, token.trim());
		} catch {}
		setToken("");
		finish("retry");
	};
	return (
		<>
			<Header title="This Hive's access token" />
			<Dialog.Description className="text-kumo-subtle">
				Changes need the token this Hive was deployed with. <span className="font-mono text-kumo-default">pnpm self-host</span> saved it in{" "}
				<span className="font-mono text-kumo-default">.hive-token</span>. It's kept in this browser.
			</Dialog.Description>
			<form onSubmit={submit} className="mt-5 flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Input label="Access token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
				</div>
				<Button type="submit" variant="primary" disabled={!token.trim()}>
					Save
				</Button>
			</form>
		</>
	);
}
