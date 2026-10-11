import type { RepoHandle, RepoHost } from "../repo/host.ts";

// Artifacts runs one fork at a time per source repository, so a burst of agents starting on one
// trunk would queue behind each other. The pool forks from trunk *and* from mirror repos
// (<repo>.m-<n>, never written by agents), one in flight per source, and adds mirrors while forks
// are queueing. Mirrors are refreshed to trunk after each landing, so forks start from current code.

export const MAX_MIRRORS = 32;
const GROW_WHEN_QUEUED_PER_SOURCE = 2;

export interface MirrorStore {
	list(): string[];
	add(name: string): void;
}

export class ForkPool {
	private readonly busy = new Map<string, number>(); // source → forks in flight (≤ 1 in practice)
	private readonly waiting: (() => void)[] = [];
	private growing = false;
	private readonly host: RepoHost;
	private readonly trunk: string;
	private readonly mirrors: MirrorStore;

	constructor(host: RepoHost, trunk: string, mirrors: MirrorStore) {
		this.host = host;
		this.trunk = trunk;
		this.mirrors = mirrors;
	}

	sources(): string[] {
		return [this.trunk, ...this.mirrors.list()];
	}

	// Fork the least busy source into `name`. Waits for a free source when all are busy.
	async fork(name: string, description: string): Promise<{ handle: RepoHandle; source: string }> {
		const source = await this.acquire();
		try {
			return { handle: await this.host.fork(source, name, description), source };
		} finally {
			this.release(source);
		}
	}

	// `priority` waiters (mirror growth) go to the front: adding capacity first helps everyone queued.
	private async acquire(priority = false): Promise<string> {
		for (;;) {
			const free = this.sources().find((s) => !this.busy.get(s));
			if (free) {
				this.busy.set(free, 1);
				return free;
			}
			if (!priority && this.waiting.length >= GROW_WHEN_QUEUED_PER_SOURCE * this.sources().length) void this.grow();
			await new Promise<void>((resolve) => (priority ? this.waiting.unshift(resolve) : this.waiting.push(resolve)));
		}
	}

	private release(source: string) {
		this.busy.delete(source);
		this.waiting.shift()?.();
	}

	// While forks are queueing, add mirrors in rounds. Each round every source forks one new mirror,
	// so capacity doubles per round (1, 2, 4, 8 …) up to MAX_MIRRORS.
	private async grow() {
		if (this.growing) return;
		this.growing = true;
		try {
			while (this.mirrors.list().length < MAX_MIRRORS && this.waiting.length >= GROW_WHEN_QUEUED_PER_SOURCE * this.sources().length) {
				const room = MAX_MIRRORS - this.mirrors.list().length;
				const count = Math.min(room, this.sources().length);
				const base = this.mirrors.list().length;
				await Promise.all(Array.from({ length: count }, (_, i) => this.addMirror(`${this.trunk}.m-${base + i}`)));
			}
		} finally {
			this.growing = false;
		}
	}

	private async addMirror(name: string) {
		try {
			if (!(await this.host.get(name))) {
				const source = await this.acquire(true);
				try {
					await this.host.fork(source, name, `Hive fork mirror of ${this.trunk}`);
				} finally {
					this.release(source);
				}
			}
			this.mirrors.add(name);
			this.waiting.shift()?.(); // a new source is free
		} catch (err) {
			console.warn(`mirror ${name} failed`, err);
		}
	}
}
