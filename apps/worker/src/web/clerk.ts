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
