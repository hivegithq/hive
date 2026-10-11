import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrice, parsePrice } from "../src/price.ts";

test("parsePrice reads dollars into cents", () => {
	assert.equal(parsePrice("$12.34"), 1234);
	assert.equal(parsePrice("1,000"), 100000);
});

test("parsePrice rejects garbage", () => {
	assert.throws(() => parsePrice("abc"));
	assert.throws(() => parsePrice("-1"));
});

test("formatPrice renders cents as dollars", () => {
	assert.equal(formatPrice(1234), "$12.34");
	assert.equal(formatPrice(5), "$0.05");
});
