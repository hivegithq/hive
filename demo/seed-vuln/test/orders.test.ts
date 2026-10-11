import assert from "node:assert/strict";
import { test } from "node:test";
import { findOrders, openDb } from "../src/db.ts";
import { readInvoice } from "../src/files.ts";
import { chargeHeaders } from "../src/payments.ts";
import { applyFormula } from "../src/pricing.ts";
import { shoutTitle } from "../src/report.ts";
import { storeSettings } from "../src/settings.ts";

test("finds a customer's orders", () => {
	const orders = findOrders(openDb(), "ada");
	assert.deepEqual(orders.map((o) => o.total), [42, 10]);
});

test("reads an invoice", () => {
	assert.match(readInvoice("2026-001.txt"), /ada: 42.00/);
});

test("shouts a report title", () => {
	assert.equal(shoutTitle("monthly sales"), "MONTHLY SALES");
});

test("prices with a formula", () => {
	assert.equal(applyFormula("subtotal * 0.9", 100), 90);
	assert.equal(applyFormula("subtotal - 5", 20), 15);
});

test("merges store settings over the defaults", () => {
	const s = storeSettings({ taxRate: 0.2, features: { giftWrap: true } });
	assert.equal(s.currency, "USD");
	assert.equal(s.taxRate, 0.2);
	assert.equal(s.features.giftWrap, true);
});

test("sends the payment key as a bearer token", () => {
	assert.match(chargeHeaders().authorization, /^Bearer \S+$/);
});
