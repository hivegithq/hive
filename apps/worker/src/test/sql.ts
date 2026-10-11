// A minimal stand-in for Durable Object SqlStorage over node:sqlite, so stores that run inside the
// coordinator can be unit-tested (and benchmarked) without the Workers runtime.
import { DatabaseSync } from "node:sqlite";

export function memorySql(): SqlStorage {
	const db = new DatabaseSync(":memory:");
	const exec = (query: string, ...bindings: unknown[]) => {
		const stmt = db.prepare(query);
		const isRead = /^\s*(SELECT|WITH)/i.test(query) || /\bRETURNING\b/i.test(query);
		const rows = isRead ? (stmt.all(...(bindings as never[])) as Record<string, SqlStorageValue>[]) : (stmt.run(...(bindings as never[])), []);
		return {
			toArray: () => rows,
			one: () => {
				if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
				return rows[0];
			},
			[Symbol.iterator]: () => rows[Symbol.iterator](),
		};
	};
	return { exec } as unknown as SqlStorage;
}
