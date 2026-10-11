import type { Cart } from "./cart.ts";
import { applyDiscount, type Discount } from "./discount.ts";

export const TAX_RATE = 0.08;
export const SHIPPING = 599; // cents

export interface Receipt {
	subtotal: number;
	discounted: number;
	tax: number;
	shipping: number;
	total: number;
}

export function checkout(cart: Cart, discount: Discount | null = null): Receipt {
	const subtotal = cart.subtotal();
	const discounted = applyDiscount(subtotal, discount);
	const tax = Math.round(discounted * TAX_RATE);
	const shipping = cart.lines().length === 0 ? 0 : SHIPPING;
	return { subtotal, discounted, tax, shipping, total: discounted + tax + shipping };
}
