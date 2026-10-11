export interface Discount {
	code: string;
	amountOff: number; // cents
}

export function applyDiscount(subtotal: number, discount: Discount | null): number {
	if (!discount) return subtotal;
	return Math.max(0, subtotal - discount.amountOff);
}
