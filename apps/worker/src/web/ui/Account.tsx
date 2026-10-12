import { UserButton, useAuth, useClerk } from "@clerk/react";
import { Button } from "@cloudflare/kumo/components/button";
import { ACCESS } from "../clerk.ts";

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
