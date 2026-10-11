// Pointy-top hexagons. `size` is the circumradius: a cell is size·√3 wide and 2·size tall.

export const SQRT3 = Math.sqrt(3);

export interface Point {
	x: number;
	y: number;
}

// Axial (q, r) to pixel centre.
export const axialToPixel = (q: number, r: number, size: number): Point => ({ x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r });

const DIRECTIONS: [number, number][] = [
	[1, 0],
	[1, -1],
	[0, -1],
	[-1, 0],
	[-1, 1],
	[0, 1],
];

// The first n cells of a hexagonal spiral, centre first: a hive that fills from its core outwards.
export function spiral(n: number): [number, number][] {
	const cells: [number, number][] = [[0, 0]];
	for (let ring = 1; cells.length < n; ring++) {
		let q = DIRECTIONS[4][0] * ring;
		let r = DIRECTIONS[4][1] * ring;
		for (let side = 0; side < 6 && cells.length < n; side++) {
			for (let step = 0; step < ring && cells.length < n; step++) {
				cells.push([q, r]);
				q += DIRECTIONS[side][0];
				r += DIRECTIONS[side][1];
			}
		}
	}
	return cells;
}

// The smallest spiral radius (in rings) holding n cells.
export const ringsFor = (n: number) => {
	let rings = 0;
	while (1 + 3 * rings * (rings + 1) < n) rings++;
	return rings;
};

// Cell centres tiling a w×h rectangle (offset rows), with a margin of one cell.
export function tile(w: number, h: number, size: number): Point[] {
	const dx = size * SQRT3;
	const dy = size * 1.5;
	const out: Point[] = [];
	for (let row = -1; row * dy < h + dy; row++) {
		for (let col = -1; col * dx < w + dx; col++) {
			out.push({ x: col * dx + (row % 2 ? dx / 2 : 0), y: row * dy });
		}
	}
	return out;
}

export function hexPath(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, size: number) {
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI / 3) * i - Math.PI / 2;
		const px = x + size * Math.cos(a);
		const py = y + size * Math.sin(a);
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

// SVG points attribute for a hexagon centred at (x, y).
export const hexPoints = (x: number, y: number, size: number) =>
	Array.from({ length: 6 }, (_, i) => {
		const a = (Math.PI / 3) * i - Math.PI / 2;
		return `${(x + size * Math.cos(a)).toFixed(2)},${(y + size * Math.sin(a)).toFixed(2)}`;
	}).join(" ");

export const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
