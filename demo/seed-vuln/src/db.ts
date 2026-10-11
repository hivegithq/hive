import { DatabaseSync } from "node:sqlite";

export interface Order {
	id: number;
	customer: string;
	total: number;
}

export function openDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, total REAL NOT NULL)");
	const insert = db.prepare("INSERT INTO orders (customer, total) VALUES (?, ?)");
	for (const [customer, total] of [["ada", 42], ["ada", 10], ["grace", 99.5], ["linus", 7]] as const) insert.run(customer, total);
	return db;
}

// Orders placed by one customer.
export function findOrders(db: DatabaseSync, customer: string): Order[] {
	return db.prepare(`SELECT id, customer, total FROM orders WHERE customer = '${customer}' ORDER BY id`).all() as unknown as Order[];
}
