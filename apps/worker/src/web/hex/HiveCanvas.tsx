import { useEffect, useRef } from "react";
import { hexPath, prefersReducedMotion, tile } from "./geometry.ts";

// The landing page's hero: a hive in which every cell is an agent. Cells fork (steel), are
// stacked into batches (orange), and land (a honey flash that fades). Now and then a batch has a
// culprit: it flashes red and goes back to work while the rest of its batch lands.
// It's an illustration of the mechanism; the numbers on the page come from real runs.

const EMPTY = 0;
const WORKING = 1;
const READY = 2;
const BATCHED = 3;
const LANDED = 4;
const CULPRIT = 5;

interface Cell {
	x: number;
	y: number;
	state: number;
	t: number; // when the current state began (ms)
	until: number; // when WORKING ends
}

export function HiveCanvas({ className, onLanded }: { className?: string; onLanded?: (n: number) => void }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const landedCb = useRef(onLanded);
	landedCb.current = onLanded;

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const still = prefersReducedMotion();
		let cells: Cell[] = [];
		let size = 16;
		let w = 0;
		let h = 0;
		const mouse = { x: -1e4, y: -1e4 };
		let batch: Cell[] = [];
		let batchAt = 0;
		let landedTotal = 0;
		let raf = 0;
		let last = 0;

		const resize = () => {
			const rect = canvas.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = rect.width;
			h = rect.height;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			size = w < 640 ? 12 : 17;
			const now = performance.now();
			cells = tile(w, h, size).map((p) => ({ ...p, state: EMPTY, t: now, until: 0 }));
			// Start mid-flight rather than empty.
			for (const c of cells) {
				const r = Math.random();
				if (r < 0.32) {
					c.state = WORKING;
					c.until = now + 500 + Math.random() * 7000;
				} else if (r < 0.42) {
					c.state = LANDED;
					c.t = now - Math.random() * 9000;
				}
			}
		};

		const step = (now: number) => {
			// Agents arrive in the empty cells.
			for (let i = 0; i < 6; i++) {
				const c = cells[(Math.random() * cells.length) | 0];
				if (c && c.state === EMPTY && now - c.t > 1500) {
					c.state = WORKING;
					c.t = now;
					c.until = now + 2500 + Math.random() * 7000;
				}
			}
			for (const c of cells) {
				if (c.state === WORKING && now > c.until) {
					c.state = READY;
					c.t = now;
				} else if (c.state === LANDED && now - c.t > 9000) {
					c.state = EMPTY;
					c.t = now;
				} else if (c.state === CULPRIT && now - c.t > 1400) {
					c.state = WORKING; // the agent fixes it and tries again
					c.t = now;
					c.until = now + 3000 + Math.random() * 4000;
				}
			}
			// A batch: stack the ready changes, verify, land them all (bar a culprit).
			if (batch.length === 0 && now - batchAt > 1800) {
				const ready = cells.filter((c) => c.state === READY);
				batch = ready.sort(() => Math.random() - 0.5).slice(0, 128);
				for (const c of batch) {
					c.state = BATCHED;
					c.t = now;
				}
				batchAt = now;
			} else if (batch.length && now - batchAt > 1300) {
				const culprit = batch.length > 8 && Math.random() < 0.35 ? batch[(Math.random() * batch.length) | 0] : null;
				let landed = 0;
				for (const c of batch) {
					c.t = now;
					if (c === culprit) c.state = CULPRIT;
					else {
						c.state = LANDED;
						landed++;
					}
				}
				landedTotal += landed;
				landedCb.current?.(landedTotal);
				batch = [];
				batchAt = now;
			}
		};

		const draw = (now: number) => {
			ctx.clearRect(0, 0, w, h);
			const inner = size - 1.6;
			for (const c of cells) {
				const dist = Math.hypot(c.x - mouse.x, c.y - mouse.y);
				const near = Math.max(0, 1 - dist / 220);
				const age = now - c.t;
				let fill: string | null = null;
				let stroke = `rgba(255,255,255,${0.05 + near * 0.22})`;
				switch (c.state) {
					case WORKING:
						stroke = `rgba(160,178,200,${0.28 + near * 0.4})`;
						fill = `rgba(125,141,161,${0.07 + near * 0.08})`;
						break;
					case READY:
						stroke = "rgba(246,130,31,0.45)";
						fill = "rgba(246,130,31,0.10)";
						break;
					case BATCHED: {
						const pulse = 0.55 + 0.45 * Math.sin(age / 90);
						stroke = `rgba(246,130,31,${0.6 + 0.4 * pulse})`;
						fill = `rgba(246,130,31,${0.18 + 0.22 * pulse})`;
						break;
					}
					case LANDED: {
						const k = Math.max(0, 1 - age / 9000);
						const flash = Math.max(0, 1 - age / 600);
						fill = `rgba(251,173,65,${0.08 + 0.5 * k * k + 0.4 * flash})`;
						stroke = `rgba(251,173,65,${0.18 + 0.55 * k})`;
						break;
					}
					case CULPRIT: {
						const k = Math.max(0, 1 - age / 1400);
						fill = `rgba(240,96,93,${0.15 + 0.55 * k})`;
						stroke = `rgba(240,96,93,${0.4 + 0.6 * k})`;
						break;
					}
				}
				ctx.beginPath();
				hexPath(ctx, c.x, c.y, inner);
				if (fill) {
					ctx.fillStyle = fill;
					ctx.fill();
				}
				ctx.strokeStyle = stroke;
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		};

		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			if (document.hidden || now - last < 33) return; // ~30 fps is plenty for this
			last = now;
			step(now);
			draw(now);
		};

		const onMove = (e: PointerEvent) => {
			const rect = canvas.getBoundingClientRect();
			mouse.x = e.clientX - rect.left;
			mouse.y = e.clientY - rect.top;
		};
		const onLeave = () => {
			mouse.x = mouse.y = -1e4;
		};

		resize();
		const ro = new ResizeObserver(() => {
			resize();
			if (still) draw(performance.now());
		});
		ro.observe(canvas);
		if (still) {
			// One representative frame: a few batches in, nothing moving.
			const t0 = performance.now();
			for (let t = 0; t < 12000; t += 100) step(t0 + t);
			draw(t0 + 12000);
		} else {
			raf = requestAnimationFrame(loop);
			window.addEventListener("pointermove", onMove, { passive: true });
			canvas.addEventListener("pointerleave", onLeave);
		}
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			window.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerleave", onLeave);
		};
	}, []);

	return <canvas ref={ref} className={className} aria-hidden="true" />;
}
