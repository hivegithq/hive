import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig(({ mode }) => {
	const selfHosted = mode === "devhost" || process.env.HIVE_SELF_HOST === "1";
	const appEntrypoint: Plugin = {
		name: "hive-app-entrypoint",
		enforce: "pre",
		transformIndexHtml(html) {
			return selfHosted ? html.replace("/src/web/main.tsx", "/src/web/self-host-main.tsx") : html;
		},
	};
	return {
		plugins: [appEntrypoint, react(), tailwindcss(), cloudflare()],
		define: { __HIVE_VERSION__: JSON.stringify(version) },
	};
});
