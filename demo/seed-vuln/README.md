# orders-service

A small order service: look up a customer's orders, download invoices, export reports, price
orders with configurable formulas, and merge settings.

**This repository has deliberately planted security bugs.** It exists to demonstrate Hive
finding and fixing them with many agents at once. Do not deploy it.

Run the tests with `npm test` (Node 24 runs the TypeScript directly).
