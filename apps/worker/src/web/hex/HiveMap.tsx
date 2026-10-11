import { useEffect, useRef } from "react";
import { axialToPixel, hexPath, prefersReducedMotion, ringsFor, SQRT3, spiral } from "./geometry.ts";

// Every change in the repository as one cell of a honeycomb that fills from the centre: landed
// changes are the honey core, converging ones pulse around it, then the queue, the agents still
// working, and anything waiting on a person. A batch landing grows the core outwards.

export type MapGroup = "landed" | "converging" | "queued" | "working" | "attention";

export const MAP_GROUPS: { id: MapGroup; label: string; rgb: [number, number, number]; fill: number; stroke: number }[] = [
	{ id: "landed", label: "Landed", rgb: [251, 173, 65], fill: 0.78, stroke: 0.95 },
	{ id: "converging", label: "Converging", rgb: [246, 130, 31], fill: 0.45, stroke: 1 },
	{ id: "queued", label: "In queue", rgb: [246, 130, 31], fill: 0.1, stroke: 0.6 },
	{ id: "working", label: "Working", rgb: [125, 141, 161], fill: 0.12, stroke: 0.55 },
	{ id: "attention", label: "Needs you", rgb: [240, 96, 93], fill: 0.6, stroke: 1 },
];

interface Cell {
	x: number;
	y: number;
	cur: number[]; // r, g, b, fill alpha, stroke alpha
	target: number[];
	group: MapGroup | null;
	flash: number; // ms timestamp of becoming landed
}

const EMPTY_LOOK = [255, 255, 255, 0, 0.05];
const LEGEND_BAND = 52;

export function HiveMap({ counts, className }: { counts: Record<MapGroup, number>; className?: string }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const state = useRef<{ cells: Cell[]; counts: Record<MapGroup, number> } | null>(null);
	const countsRef = useRef(counts);
	countsRef.current = counts;

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const still = prefersReducedMotion();
		let raf = 0;
		let w = 0;
		let h = 0;
		let size = 8;
		let capacity = 0;

		const layout = () => {
			const rect = canvas.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = rect.width;
			h = rect.height;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const total = Object.values(countsRef.current).reduce((a, b) => a + b, 0);
			// Room to grow: lay out at least 61 cells (4 rings) and 15% headroom.
			capacity = Math.max(61, Math.ceil(total * 1.15));
			const rings = ringsFor(capacity);
			// The spiral is (2·rings+1) cells across and about 1.5·(2·rings)+2 cells tall.
			// Keep a band at the bottom free for the legend.
			const room = h - LEGEND_BAND;
			size = Math.max(2.5, Math.min(22, w / (SQRT3 * (2 * rings + 1) + 1), room / (3 * rings + 2.6)));
			const prev = state.current?.cells ?? [];
			const cells: Cell[] = spiral(capacity).map(([q, r], i) => {
				const p = axialToPixel(q, r, size);
				const old = prev[i];
				return { x: w / 2 + p.x, y: (h - LEGEND_BAND) / 2 + 6 + p.y, cur: old ? old.cur : [...EMPTY_LOOK], target: [...EMPTY_LOOK], group: old?.group ?? null, flash: 0 };
			});
			state.current = { cells, counts: state.current?.counts ?? { landed: 0, converging: 0, queued: 0, working: 0, attention: 0 } };
			assign(performance.now());
		};

		// Groups take consecutive runs of the spiral, centre outwards, in MAP_GROUPS order.
		const assign = (now: number) => {
			const s = state.current;
			if (!s) return;
			const c = countsRef.current;
			let i = 0;
			for (const g of MAP_GROUPS) {
				for (let k = 0; k < c[g.id] && i < s.cells.length; k++, i++) {
					const cell = s.cells[i];
					if (g.id === "landed" && cell.group !== "landed" && s.counts.landed < c.landed) cell.flash = now;
					cell.group = g.id;
					cell.target = [...g.rgb, g.fill, g.stroke];
				}
			}
			for (; i < s.cells.length; i++) {
				s.cells[i].group = null;
				s.cells[i].target = [...EMPTY_LOOK];
			}
			s.counts = { ...c };
		};

		const draw = (now: number, settle: boolean) => {
			const s = state.current;
			if (!s) return;
			ctx.clearRect(0, 0, w, h);
			const inner = size * 0.9;
			for (const cell of s.cells) {
				for (let k = 0; k < 5; k++) cell.cur[k] = settle ? cell.target[k] : cell.cur[k] + (cell.target[k] - cell.cur[k]) * 0.12;
				const [r, g, b, fa, sa] = cell.cur;
				let fill = fa;
				let stroke = sa;
				if (cell.group === "converging" && !still) {
					const pulse = 0.5 + 0.5 * Math.sin(now / 260 + cell.x * 0.05);
					fill = fa * (0.55 + 0.45 * pulse);
					stroke = sa * (0.6 + 0.4 * pulse);
				}
				const flash = cell.flash ? Math.max(0, 1 - (now - cell.flash) / 900) : 0;
				ctx.beginPath();
				hexPath(ctx, cell.x, cell.y, inner);
				if (fill > 0.005 || flash) {
					ctx.fillStyle = flash ? `rgba(255,244,224,${Math.min(1, fill + flash)})` : `rgba(${r | 0},${g | 0},${b | 0},${fill})`;
					ctx.fill();
				}
				if (size > 3.5) {
					ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${stroke})`;
					ctx.lineWidth = size > 10 ? 1.2 : 0.8;
					ctx.stroke();
				}
			}
		};

		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			const s = state.current;
			if (s && MAP_GROUPS.some((g) => s.counts[g.id] !== countsRef.current[g.id])) {
				const total = Object.values(countsRef.current).reduce((a, b) => a + b, 0);
				if (total > capacity) layout();
				else assign(now);
			}
			if (!document.hidden) draw(now, false);
		};

		layout();
		const ro = new ResizeObserver(() => {
			layout();
			if (still) draw(performance.now(), true);
		});
		ro.observe(canvas);
		const onCounts = () => {
			const total = Object.values(countsRef.current).reduce((a, b) => a + b, 0);
			if (total > capacity) layout();
			else assign(performance.now());
			draw(performance.now(), true);
		};
		if (still) {
			draw(performance.now(), true);
			canvas.addEventListener("hive:counts", onCounts);
		} else raf = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			canvas.removeEventListener("hive:counts", onCounts);
		};
	}, []);

	// With reduced motion there's no loop, so redraw when the counts change.
	useEffect(() => {
		if (!prefersReducedMotion() || !ref.current) return;
		ref.current.dispatchEvent(new Event("hive:counts"));
	}, [counts]);

	return <canvas ref={ref} className={className} role="img" aria-label={MAP_GROUPS.map((g) => `${counts[g.id]} ${g.label.toLowerCase()}`).join(", ")} />;
}
