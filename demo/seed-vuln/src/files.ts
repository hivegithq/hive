import { readFileSync } from "node:fs";
import { join } from "node:path";

export const INVOICE_DIR = new URL("../invoices/", import.meta.url).pathname;

// The contents of an invoice, by file name, e.g. "2026-001.txt".
export function readInvoice(name: string): string {
	return readFileSync(join(INVOICE_DIR, name), "utf8");
}
