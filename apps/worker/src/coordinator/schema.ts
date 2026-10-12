// SQLite schema for a RepoCoordinator (one per trunk repo). JSON columns hold arrays/maps.
export const SCHEMA = [
	// A planned goal's sub-goals start only when the sub-goals they depend on have landed.
	`CREATE TABLE IF NOT EXISTS goal_deps (goal_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (goal_id, depends_on))`,
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
	// The latest diff of each change against its base: from the agent when it submits, then from the
	// merge box when the change is checked (the diff that would land).
	`CREATE TABLE IF NOT EXISTS diffs (
		change_id TEXT PRIMARY KEY, source TEXT NOT NULL, base TEXT NOT NULL, head TEXT NOT NULL,
		diff TEXT NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
	// What the work cost: one row per model call (tokens) or container run (seconds).
	`CREATE TABLE IF NOT EXISTS usage (
		id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
		change_id TEXT, goal_id TEXT, agent_id TEXT, input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0, seconds REAL NOT NULL DEFAULT 0, cost REAL NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS usage_by_goal ON usage (goal_id)`,
	`CREATE INDEX IF NOT EXISTS usage_by_change ON usage (change_id)`,
	// Goals made from issues elsewhere (GitHub): owner/repo#number, so imports don't repeat.
	`CREATE TABLE IF NOT EXISTS goal_issues (goal_id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, url TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS goal_budgets (goal_id TEXT PRIMARY KEY, budget REAL)`,
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
	`CREATE TABLE IF NOT EXISTS metrics (name TEXT NOT NULL, value REAL NOT NULL, at INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS metrics_by_name ON metrics (name, at)`,
	`CREATE INDEX IF NOT EXISTS changes_by_status ON changes (status, submitted_at)`,
	`CREATE INDEX IF NOT EXISTS decisions_by_change ON decisions (change_id, created_at)`,
	`CREATE INDEX IF NOT EXISTS evidence_by_change ON evidence (change_id, created_at)`,
];
