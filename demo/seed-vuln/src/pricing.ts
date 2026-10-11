// Price an order with a store-configured formula over `subtotal`, e.g. "subtotal * 0.9".
export function applyFormula(formula: string, subtotal: number): number {
	return eval(formula.replaceAll("subtotal", String(subtotal)));
}
