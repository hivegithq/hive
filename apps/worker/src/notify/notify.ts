// Telling people when something needs them: webhooks, as signed JSON or in Slack's or Discord's
// incoming-webhook format.

export const EVENTS = ["needs-you", "goal-landed", "race-finished", "trunk-failing"] as const;
export type NotifyEvent = (typeof EVENTS)[number];
export type Format = "json" | "slack" | "discord";

export interface Hook {
	id: string;
	url: string;
	format: Format;
	events: NotifyEvent[];
	secret: string; // sealed; signs JSON deliveries
	createdAt: number;
	last: { at: number; ok: boolean; status: number | null; error: string | null } | null;
}

export interface Notice {
	event: NotifyEvent;
	repo: string;
	text: string; // one line for people
	link: string; // where to look
	goalId?: string;
	changeId?: string;
	at: number;
}

export function payload(format: Format, n: Notice): string {
	if (format === "slack") return JSON.stringify({ text: `*${n.repo}*: ${n.text} <${n.link}|Open>` });
	if (format === "discord") return JSON.stringify({ content: `**${n.repo}**: ${n.text} ${n.link}` });
	return JSON.stringify(n);
}

export async function sign(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
	return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// The webhook URL must be https and must not point into private networks.
export function checkUrl(raw: string): string | null {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return "not a URL";
	}
	if (u.protocol !== "https:") return "webhooks must use https";
	if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return "that host is private";
	return null;
}

export const maskUrl = (raw: string) => {
	try {
		const u = new URL(raw);
		return `${u.protocol}//${u.host}/…${u.pathname.slice(-4)}`;
	} catch {
		return "…";
	}
};

export const formatFor = (url: string): Format =>
	/hooks\.slack\.com/.test(url) ? "slack" : /discord(app)?\.com\/api\/webhooks/.test(url) ? "discord" : "json";
