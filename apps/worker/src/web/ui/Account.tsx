import { Button } from "@cloudflare/kumo/components/button";
import { useEffect, useRef } from "react";
import { ACCESS, loadClerk, openSignIn, openWaitlist, SITE_URL, useAuthState } from "../clerk.ts";
import { askForAccess } from "./AccessDialog.tsx";

// Who you are on this Hive: your avatar once signed in, otherwise a way onto the waitlist and a
// sign-in for people who already have access. Nothing on a Hive without sign-in.
export function Account({ compact = false }: { compact?: boolean }) {
	return ACCESS === "clerk" ? <SignedInOrNot compact={compact} /> : null;
}

function SignedInOrNot({ compact }: { compact: boolean }) {
	const { status, signedIn } = useAuthState();
	if (status === "loading") return <span className="inline-block h-8 w-8" />;
	if (status === "ready" && signedIn) return <Avatar />;
	return (
		<span className="flex items-center gap-1">
			{!compact && (
				<Button variant="ghost" size="sm" onClick={() => openSignIn().catch(() => {})}>
					Sign in
				</Button>
			)}
			<Button variant="secondary" size="sm" onClick={() => openWaitlist().catch(() => {})}>
				Join the waitlist
			</Button>
		</span>
	);
}

// Clerk's own account menu, mounted into a node of ours.
function Avatar() {
	const el = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const node = el.current;
		if (!node) return;
		let mounted = false;
		loadClerk().then((c) => {
			if (!node.isConnected) return;
			c.mountUserButton(node);
			mounted = true;
		});
		return () => {
			if (mounted) window.Clerk?.unmountUserButton(node);
		};
	}, []);
	return <div ref={el} className="flex h-8 w-8 items-center justify-center" />;
}

// Whether this visitor can make changes, as far as the page can tell. ACCESS never changes while
// the page is open.
export function useCanWrite(): boolean {
	const { signedIn } = useAuthState();
	if (ACCESS === "clerk") return signedIn;
	return ACCESS === "token";
}

// Wrap a write: run it when the visitor can make changes, otherwise explain how to get access
// first and run it once they have.
export function useGuard() {
	const canWrite = useCanWrite();
	return (fn: () => void) => () => {
		if (canWrite) return fn();
		askForAccess().then((a) => a === "retry" && fn());
	};
}

// In place of a control a visitor can't use yet: what it would do, and how to get access.
export function SignInToAct({ what, className = "" }: { what: string; className?: string }) {
	return (
		<div className={`cut-sm bg-honey/[0.06] p-4 ring-1 ring-honey/25 ${className}`}>
			<p className="text-sm leading-relaxed text-kumo-default">
				{ACCESS === "elsewhere" ? (
					<>
						Sign in on{" "}
						<a href={`${SITE_URL}${location.pathname}`} className="text-honey underline-offset-4 hover:underline">
							{SITE_URL.replace("https://", "")}
						</a>{" "}
						to {what}.
					</>
				) : (
					<>Anyone can watch. To {what}, sign in: people on the waitlist get access as it opens up.</>
				)}
			</p>
			{ACCESS === "clerk" && (
				<div className="mt-3 flex flex-wrap gap-2">
					<Button variant="primary" size="sm" onClick={() => openWaitlist().catch(() => {})}>
						Join the waitlist
					</Button>
					<Button variant="ghost" size="sm" onClick={() => openSignIn().catch(() => {})}>
						Sign in
					</Button>
				</div>
			)}
		</div>
	);
}
