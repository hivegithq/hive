import { Button } from "@cloudflare/kumo/components/button";
import { askForAccess } from "./AccessDialog.tsx";

// Self-hosted deployments use one owner token. There is no public sign-up or sign-in flow.
export function Account({ compact = false }: { compact?: boolean }) {
	return (
		<Button variant="ghost" size="sm" onClick={() => void askForAccess()}>
			{compact ? "Owner access" : "Enter owner token"}
		</Button>
	);
}

// The server is the authority: an attempted write without the owner token opens the token dialog.
export function useCanWrite(): boolean {
	return true;
}

export function useGuard() {
	return (fn: () => void) => () => fn();
}

export function SignInToAct({ what, className = "" }: { what: string; className?: string }) {
	return (
		<div className={`cut-sm bg-honey/[0.06] p-4 ring-1 ring-honey/25 ${className}`}>
			<p className="text-sm leading-relaxed text-kumo-default">To {what}, use the owner access token for this self-hosted Hive.</p>
			<Button className="mt-3" variant="secondary" size="sm" onClick={() => void askForAccess()}>
				Enter owner token
			</Button>
		</div>
	);
}
