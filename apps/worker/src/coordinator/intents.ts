import type { Intent, SymbolRef } from "../domain/types.ts";
import type { ReferenceGraph } from "./overlap.ts";

// Live intents are indexed by the files they touch, so an overlap check reads only the intents that
// could possibly collide (same file, or a file the semantic graph links to) instead of all of them.
// With thousands of agents in flight this is the difference between O(live) and O(neighbours).

export const INTENT_SCHEMA = [
	`CREATE TABLE IF NOT EXISTS intent_targets (intent_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (path, intent_id))`,
	`CREATE INDEX IF NOT EXISTS intent_targets_by_intent ON intent_targets (intent_id)`,
	`CREATE INDEX IF NOT EXISTS intents_live ON intents (change_id) WHERE released_at IS NULL`,
];

type Row = Record<string, SqlStorageValue>;

export function toIntent(r: Row): Intent {
	return {
		id: String(r.id),
		changeId: String(r.change_id),
		agentId: String(r.agent_id),
		summary: String(r.summary),
		paths: JSON.parse(String(r.paths)),
		symbols: JSON.parse(String(r.symbols)),
		createdAt: Number(r.created_at),
		releasedAt: r.released_at === null ? null : Number(r.released_at),
	};
}

export const touched = (i: Pick<Intent, "paths" | "symbols">) => [...new Set([...i.paths, ...i.symbols.map((s) => s.path)])];

export class IntentStore {
	private readonly db: SqlStorage;
	constructor(db: SqlStorage) {
		this.db = db;
	}

	insert(intent: Intent) {
		this.db.exec(
			"INSERT INTO intents VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
			intent.id,
			intent.changeId,
			intent.agentId,
			intent.summary,
			JSON.stringify(intent.paths),
			JSON.stringify(intent.symbols),
			intent.createdAt,
		);
		for (const path of touched(intent)) this.db.exec("INSERT OR IGNORE INTO intent_targets VALUES (?, ?)", intent.id, path);
	}

	// Release a change's live intent(s); returns the released intent ids.
	release(changeId: string, at: number): string[] {
		const ids = this.db
			.exec("SELECT id FROM intents WHERE change_id = ? AND released_at IS NULL", changeId)
			.toArray()
			.map((r) => String(r.id));
		for (const id of ids) {
			this.db.exec("UPDATE intents SET released_at = ? WHERE id = ?", at, id);
			this.db.exec("DELETE FROM intent_targets WHERE intent_id = ?", id);
		}
		return ids;
	}

	forChange(changeId: string): Intent | null {
		const row = this.db.exec("SELECT * FROM intents WHERE change_id = ? ORDER BY created_at DESC LIMIT 1", changeId).toArray()[0];
		return row ? toIntent(row) : null;
	}

	live(limit = 500): Intent[] {
		return this.db.exec("SELECT * FROM intents WHERE released_at IS NULL ORDER BY created_at DESC LIMIT ?", limit).toArray().map(toIntent);
	}

	liveCount(): number {
		return Number(this.db.exec("SELECT COUNT(*) AS n FROM intents WHERE released_at IS NULL").one().n);
	}

	// Live intents that could overlap `intent`: they touch one of its files, or a file holding a
	// symbol that calls (or is called by) one of its symbols.
	candidates(intent: Intent, graph: ReferenceGraph & { dependenciesOf(s: SymbolRef): SymbolRef[] }): Intent[] {
		const related = intent.symbols.flatMap((s) => [...graph.dependentsOf(s), ...graph.dependenciesOf(s)]).map((s) => s.path);
		const paths = [...new Set([...touched(intent), ...related])];
		if (paths.length === 0) return [];
		return this.db
			.exec(
				`SELECT DISTINCT i.* FROM intent_targets t JOIN intents i ON i.id = t.intent_id
				 WHERE t.path IN (SELECT value FROM json_each(?)) AND i.change_id != ? AND i.released_at IS NULL`,
				JSON.stringify(paths),
				intent.changeId,
			)
			.toArray()
			.map(toIntent);
	}
}
