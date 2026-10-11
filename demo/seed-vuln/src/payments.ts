// Charges go through the payment provider's API.
const PAYMENT_API_KEY = "__GENERATED_LIVE_KEY__";

export function chargeHeaders(): Record<string, string> {
	return { authorization: `Bearer ${PAYMENT_API_KEY}`, "content-type": "application/json" };
}
