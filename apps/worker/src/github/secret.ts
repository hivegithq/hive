// Secrets Hive keeps for a repository (a GitHub token): AES-GCM, with a key derived from the
// deployment's HIVE_TOKEN. Rotating HIVE_TOKEN makes stored secrets unreadable: reconnect then.

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(master: string): Promise<CryptoKey> {
	const base = await crypto.subtle.importKey("raw", enc.encode(master), "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: enc.encode("hive/github-token/v1"), info: enc.encode("repository secret") },
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function seal(master: string, plaintext: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(master), enc.encode(plaintext)));
	return `v1.${b64(iv)}.${b64(cipher)}`;
}

export async function open(master: string, sealed: string): Promise<string | null> {
	const [v, iv, cipher] = sealed.split(".");
	if (v !== "v1" || !iv || !cipher) return null;
	try {
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await keyFrom(master), unb64(cipher));
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}
