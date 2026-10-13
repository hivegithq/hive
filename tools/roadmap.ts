// Writes docs/ROADMAP.md from the roadmap data the docs site renders (apps/worker/src/web/docs/roadmap.ts),
// so the two never drift: `pnpm roadmap`.

import { writeFileSync } from "node:fs";
import { NEXT, SHIPPED } from "../apps/worker/src/web/docs/roadmap.ts";

const bar = (p: number) => `${"█".repeat(Math.round(p / 10))}${"░".repeat(10 - Math.round(p / 10))}`;
const lines = [
	"# Roadmap",
	"",
	"What Hive does next, and how far along each piece is. Also at <https://hivegit.dev/docs/roadmap>.",
	"Generated from `apps/worker/src/web/docs/roadmap.ts` by",
	"`pnpm roadmap`: edit that file, not this one.",
	"",
	"## Next",
	"",
	"| Item | Progress | |",
	"|---|---|---|",
	...NEXT.map((i) => `| **${i.title}**${i.from ? ` (from ${i.from})` : ""} | \`${bar(i.progress)}\` ${i.progress}% | ${i.what}${i.have ? ` *Today:* ${i.have}` : ""} |`),
	"",
	"## Shipped",
	"",
	"| | Version |",
	"|---|---|",
	...SHIPPED.map((s) => `| ${s.title}${s.from ? ` (from ${s.from})` : ""} | ${s.version} |`),
	"",
	"## How Hive is built",
	"",
	"Items are built by hand or, for a showcase, by Hive itself on a free-tier Workers AI model, gated",
	"by Hive's own checks (typecheck, vitest, `cargo test`). The plan and the measured costs are in",
	"[Hive builds Hive](HIVE-BUILDS-HIVE.md); what shipped when is in the [changelog](../CHANGELOG.md).",
	"",
];
writeFileSync(new URL("../docs/ROADMAP.md", import.meta.url), lines.join("\n"));
console.log(`docs/ROADMAP.md: ${NEXT.length} next, ${SHIPPED.length} shipped`);
