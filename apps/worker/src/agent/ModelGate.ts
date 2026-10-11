import { DurableObject } from "cloudflare:workers";

// One gate per model, shared by every agent and reviewer on the account. Callers reserve a slot
// before each model call. The rate adapts like TCP congestion control: halve on a rate-limit
// response, creep up on success. Swarms slow down together instead of failing one by one.

const START_RPM = 120;
const MIN_RPM = 6;
const MAX_RPM = 3000;

export class ModelGate extends DurableObject<Env> {
	private rpm = START_RPM;
	private nextFree = 0;

	// Reserve the next slot; returns how long the caller should wait before calling the model.
	acquire(): number {
		const now = Date.now();
		const at = Math.max(now, this.nextFree);
		this.nextFree = at + 60_000 / this.rpm;
		return at - now;
	}

	report(rateLimited: boolean): number {
		this.rpm = rateLimited ? Math.max(MIN_RPM, this.rpm / 2) : Math.min(MAX_RPM, this.rpm + 1);
		return this.rpm;
	}

	state() {
		return { rpm: Math.round(this.rpm), backlogMs: Math.max(0, this.nextFree - Date.now()) };
	}
}
