import { UserButton, useAuth, useClerk } from "@clerk/react";
import { Button } from "@cloudflare/kumo/components/button";
import { ACCESS, SITE_URL } from "../clerk.ts";
import { askForAccess } from "./AccessDialog.tsx";

// Who you are on this Hive: your avatar once signed in, otherwise a way onto the waitlist and a
// sign-in for people who already have access. Nothing on a Hive without sign-in.
export function Account({ compact = false }: { compact?: boolean }) {
	return ACCESS === "clerk" ? <SignedInOrNot compact={compact} /> : null;
}

function SignedInOrNot({ compact }: { compact: boolean }) {
	const { isLoaded, isSignedIn } = useAuth();
	const clerk = useClerk();
	if (!isLoaded) return <span className="inline-block h-8 w-8" />;
	if (isSignedIn) return <UserButton />;
	return (
		<span className="flex items-center gap-1">
			{!compact && (
				<Button variant="ghost" size="sm" onClick={() => clerk.openSignIn({})}>
					Sign in
				</Button>
			)}
			<Button variant="secondary" size="sm" onClick={() => clerk.openWaitlist({})}>
				Join the waitlist
			</Button>
		</span>
	);
}

// Whether this visitor can make changes, as far as the page can tell. ACCESS never changes while
// the page is open, so the hook below is always called (or never) for a given page.
export function useCanWrite(): boolean {
	// biome-ignore lint/correctness/useHookAtTopLevel: ACCESS is fixed for the page's lifetime
	if (ACCESS === "clerk") return useAuth().isSignedIn === true;
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
			{ACCESS === "clerk" && <SignInButtons />}
		</div>
	);
}

function SignInButtons() {
	const clerk = useClerk();
	return (
		<div className="mt-3 flex flex-wrap gap-2">
			<Button variant="primary" size="sm" onClick={() => clerk.openWaitlist({})}>
				Join the waitlist
			</Button>
			<Button variant="ghost" size="sm" onClick={() => clerk.openSignIn({})}>
				Sign in
			</Button>
		</div>
	);
}
