import assert from "node:assert/strict";
import { test } from "node:test";
import { Cart } from "../src/cart.ts";

test("adding the same sku increments quantity", () => {
	const cart = new Cart();
	cart.add("tee", "T-shirt", 2000);
	cart.add("tee", "T-shirt", 2000);
	assert.equal(cart.lines()[0].quantity, 2);
	assert.equal(cart.subtotal(), 4000);
});

test("remove drops the line", () => {
	const cart = new Cart();
	cart.add("tee", "T-shirt", 2000);
	cart.remove("tee");
	assert.equal(cart.subtotal(), 0);
});
