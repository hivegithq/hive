# Shop

A tiny storefront library. Money is always integer **cents** internally.

- `src/price.ts` — parsing and formatting money
- `src/cart.ts` — the `Cart` (line items, subtotal)
- `src/discount.ts` — discount rules
- `src/checkout.ts` — totals with tax and shipping

Conventions: pure functions where possible, no dependencies, tests in `test/` using `node:test`.
Run `npm test` and `npm run typecheck` before submitting.
