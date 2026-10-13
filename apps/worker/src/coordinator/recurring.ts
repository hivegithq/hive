// Goals that come back on a schedule: nightly "fix new lint warnings", weekly "update dependencies".

export const MIN_MINUTES = 60;

// "30m", "6h", "2d", "hourly", "daily", "weekly", or "every 6h".
export function parseEvery(input: string): number | null {
	const s = input.trim().toLowerCase().replace(/^every\s+/, "");
	const named: Record<string, number> = { hourly: 60, daily: 24 * 60, nightly: 24 * 60, weekly: 7 * 24 * 60 };
	if (s in named) return named[s];
	const m = /^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(s);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = m[2][0];
	const minutes = unit === "m" ? n : unit === "h" ? n * 60 : unit === "d" ? n * 24 * 60 : n * 7 * 24 * 60;
	return minutes >= MIN_MINUTES ? minutes : null;
}

export const describeEvery = (minutes: number) =>
	minutes % (7 * 24 * 60) === 0 ? `every ${minutes / (7 * 24 * 60)} week${minutes === 7 * 24 * 60 ? "" : "s"}` : minutes % (24 * 60) === 0 ? `every ${minutes / (24 * 60)} day${minutes === 24 * 60 ? "" : "s"}` : minutes % 60 === 0 ? `every ${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `every ${minutes} minutes`;

export interface Schedule {
	id: string;
	enabled: boolean;
	everyMinutes: number;
	nextRun: number;
	lastGoalStatus: string | null; // the previous run's goal, if there was one
}

const RUNNING = new Set(["open", "in_progress", "planning", "planned", "racing"]);

// Which schedules should start a run now. A run is skipped while the previous one is still going,
// so a slow goal never piles up copies of itself.
export function dueNow(schedules: Schedule[], now: number): { run: string[]; skipped: string[] } {
	const run: string[] = [];
	const skipped: string[] = [];
	for (const s of schedules) {
		if (!s.enabled || s.nextRun > now) continue;
		(s.lastGoalStatus && RUNNING.has(s.lastGoalStatus) ? skipped : run).push(s.id);
	}
	return { run, skipped };
}

// After a run (or a skip), the next one is a full interval later, not a burst of catch-up runs.
export const nextAfter = (now: number, everyMinutes: number) => now + everyMinutes * 60_000;
