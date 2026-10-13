// Sign-in with Clerk, when this deployment has a publishable key (injected at build time).
// A production key only works on its own site (clerk.example.com serves example.com and its
// subdomains), so elsewhere (workers.dev, localhost) the site falls back to the access token.
declare const __HIVE_CLERK_KEY__: string;
export const CLERK_KEY: string = typeof __HIVE_CLERK_KEY__ === "string" ? __HIVE_CLERK_KEY__ : "";

const site = (() => {
	const m = CLERK_KEY.match(/^pk_(?:live|test)_(.+)$/);
	if (!m) return null;
	try {
		return atob(m[1])
			.replace(/\$$/, "")
			.replace(/^clerk\./, "");
	} catch {
		return null;
	}
})();

const onSite = (host: string) => !!site && (host === site || host.endsWith(`.${site}`) || CLERK_KEY.startsWith("pk_test_"));

// "clerk": people sign in here. "elsewhere": this deployment has sign-in, but on its own domain.
// "token": no sign-in; the owner's HIVE_TOKEN is the way to make changes (self-hosted Hives).
export const ACCESS: "clerk" | "elsewhere" | "token" = !site ? "token" : onSite(location.hostname) ? "clerk" : "elsewhere";
export const SITE_URL = site ? `https://${site}` : "";

// ── Loading Clerk only when it's needed ─────────────────────────────────────
// Clerk's script is ~150 KB, so pages don't carry it: it loads when the visitor already has a session
// (Clerk leaves a cookie), or when they ask to sign in or join the waitlist.

import { useSyncExternalStore } from "react";

interface ClerkJS {
	load(options?: unknown): Promise<void>;
	session?: { getToken(): Promise<string | null> } | null;
	openSignIn(options?: unknown): void;
	openWaitlist(options?: unknown): void;
	mountUserButton(el: HTMLElement, options?: unknown): void;
	unmountUserButton(el: HTMLElement): void;
	addListener(callback: () => void): () => void;
}

declare global {
	interface Window {
		Clerk?: ClerkJS;
	}
}

const APPEARANCE = {
	variables: {
		colorPrimary: "#fbad41",
		colorPrimaryForeground: "#0d0d0f",
		colorBackground: "#141417",
		colorForeground: "#fff4e0",
		colorMutedForeground: "#a1a1aa",
		colorInput: "#1c1c20",
		colorInputForeground: "#fff4e0",
		colorNeutral: "#fff4e0",
		colorBorder: "#2e2e33",
		colorModalBackdrop: "rgba(13,13,15,0.75)",
		borderRadius: "0.375rem",
	},
};

type AuthState = { status: "off" | "loading" | "ready"; signedIn: boolean };
let state: AuthState = { status: "off", signedIn: false };
const listeners = new Set<() => void>();
const setState = (next: Partial<AuthState>) => {
	state = { ...state, ...next };
	for (const l of listeners) l();
};

// Did Clerk leave a signed-in marker for this site? (Its `__client_uat` cookie is 0 when signed out.)
export const hasSessionHint = () => /(?:^|;\s*)__client_uat(?:_[^=]*)?=(?!0(?:;|$))\d+/.test(document.cookie);

const script = (src: string, key?: string) =>
	new Promise<void>((resolve, reject) => {
		const el = document.createElement("script");
		el.src = src;
		el.async = true;
		el.crossOrigin = "anonymous";
		if (key) el.setAttribute("data-clerk-publishable-key", key);
		el.onload = () => resolve();
		el.onerror = () => reject(new Error(`couldn't load ${src}`));
		document.head.appendChild(el);
	});

let loading: Promise<ClerkJS> | null = null;
export function loadClerk(): Promise<ClerkJS> {
	if (ACCESS !== "clerk") return Promise.reject(new Error("sign-in isn't available here"));
	loading ??= (async () => {
		setState({ status: "loading" });
		const api = atob(CLERK_KEY.replace(/^pk_(?:live|test)_/, "")).replace(/\$$/, "");
		await script(`https://${api}/npm/@clerk/ui@1/dist/ui.browser.js`);
		await script(`https://${api}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, CLERK_KEY);
		const clerk = window.Clerk;
		if (!clerk) throw new Error("Clerk didn't start");
		await clerk.load({ ui: { ClerkUI: (window as unknown as { __internal_ClerkUICtor?: unknown }).__internal_ClerkUICtor }, appearance: APPEARANCE });
		const sync = () => setState({ status: "ready", signedIn: !!clerk.session });
		clerk.addListener(sync);
		sync();
		return clerk;
	})().catch((err) => {
		loading = null;
		setState({ status: "off" });
		throw err;
	});
	return loading;
}

// Start loading now if this visitor probably has a session; otherwise wait to be asked.
export function startClerkIfSignedIn() {
	if (ACCESS === "clerk" && hasSessionHint()) loadClerk().catch(() => {});
}

export const openWaitlist = () => loadClerk().then((c) => c.openWaitlist({}));
export const openSignIn = () => loadClerk().then((c) => c.openSignIn({}));

// The session token for API calls, or null when signed out.
export async function sessionToken(): Promise<string | null> {
	if (ACCESS !== "clerk") return null;
	if (!loading && !hasSessionHint()) return null;
	try {
		return (await (await loadClerk()).session?.getToken()) ?? null;
	} catch {
		return null;
	}
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};
export const useAuthState = () => useSyncExternalStore(subscribe, () => state);
