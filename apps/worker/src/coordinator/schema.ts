// SQLite schema for a RepoCoordinator (one per trunk repo). JSON columns hold arrays/maps.
export const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS goals (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
		status TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS changes (
		id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, fork TEXT NOT NULL, agent_id TEXT NOT NULL,
		model TEXT NOT NULL, status TEXT NOT NULL, genesis TEXT NOT NULL, head TEXT,
		race_group TEXT, race_index INTEGER, race_won INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
		submitted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS intents (
		id TEXT PRIMARY KEY, change_id TEXT NOT NULL, agent_id TEXT NOT NULL, summary TEXT NOT NULL,
		paths TEXT NOT NULL, symbols TEXT NOT NULL, created_at INTEGER NOT NULL, released_at INTEGER)`,
	`CREATE TABLE IF NOT EXISTS evidence (
		id TEXT PRIMARY KEY, change_id TEXT NOT NULL, kind TEXT NOT NULL, command TEXT NOT NULL,
		ok INTEGER NOT NULL, output TEXT NOT NULL, commit_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS evaluations (
		id TEXT PRIMARY KEY, change_id TEXT NOT NULL, model TEXT NOT NULL, score REAL NOT NULL,
		summary TEXT NOT NULL, concerns TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS decisions (
		id TEXT PRIMARY KEY, change_id TEXT NOT NULL, outcome TEXT NOT NULL, confidence REAL NOT NULL,
		probabilities TEXT NOT NULL, rationale TEXT NOT NULL, decided_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS agents (
		id TEXT PRIMARY KEY, kind TEXT NOT NULL, model TEXT NOT NULL, trust REAL NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY, from_agent TEXT NOT NULL, to_agent TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	// Semantic graph of trunk: symbols and who references them.
	`CREATE TABLE IF NOT EXISTS symbols (path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (path, name))`,
	`CREATE TABLE IF NOT EXISTS refs (
		from_path TEXT NOT NULL, from_name TEXT NOT NULL, to_path TEXT NOT NULL, to_name TEXT NOT NULL,
		PRIMARY KEY (from_path, from_name, to_path, to_name))`,
	`CREATE INDEX IF NOT EXISTS refs_to ON refs (to_path, to_name)`,
	`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS ledger_dirty (change_id TEXT PRIMARY KEY)`,
];
