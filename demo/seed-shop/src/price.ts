// Money is integer cents everywhere in this codebase.

export function parsePrice(text: string): number {
	const cleaned = text.replace(/[$,\s]/g, "");
	const value = Number(cleaned);
	if (!Number.isFinite(value) || value < 0) throw new Error(`invalid price: ${text}`);
	return Math.round(value * 100);
}

export function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}
