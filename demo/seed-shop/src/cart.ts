export interface LineItem {
	sku: string;
	name: string;
	unitPrice: number; // cents
	quantity: number;
}

export class Cart {
	private items = new Map<string, LineItem>();

	add(sku: string, name: string, unitPrice: number): void {
		const existing = this.items.get(sku);
		if (existing) existing.quantity += 1;
		else this.items.set(sku, { sku, name, unitPrice, quantity: 1 });
	}

	remove(sku: string): void {
		this.items.delete(sku);
	}

	lines(): LineItem[] {
		return [...this.items.values()];
	}

	subtotal(): number {
		return this.lines().reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
	}
}
