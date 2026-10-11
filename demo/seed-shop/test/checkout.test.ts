import assert from "node:assert/strict";
import { test } from "node:test";
import { Cart } from "../src/cart.ts";
import { checkout } from "../src/checkout.ts";

test("checkout adds tax and shipping", () => {
	const cart = new Cart();
	cart.add("mug", "Mug", 1000);
	assert.deepEqual(checkout(cart), { subtotal: 1000, discounted: 1000, tax: 80, shipping: 599, total: 1679 });
});

test("empty cart ships free", () => {
	assert.equal(checkout(new Cart()).total, 0);
});

test("discounts apply before tax", () => {
	const cart = new Cart();
	cart.add("mug", "Mug", 1000);
	const receipt = checkout(cart, { code: "TEN", amountOff: 100 });
	assert.equal(receipt.discounted, 900);
	assert.equal(receipt.tax, 72);
});
