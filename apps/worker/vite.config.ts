import { existsSync, readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Clerk's publishable key, as in cloudflare.config.ts. Left out in devhost mode.
const clerkFile = new URL("../../.hive-clerk", import.meta.url);
const clerkKey = process.env.HIVE_CLERK_PUBLISHABLE_KEY || (existsSync(clerkFile) ? readFileSync(clerkFile, "utf8").trim() : "");

export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss(), cloudflare()],
	define: { __HIVE_VERSION__: JSON.stringify(version), __HIVE_CLERK_KEY__: JSON.stringify(mode === "devhost" ? "" : clerkKey) },
}));
