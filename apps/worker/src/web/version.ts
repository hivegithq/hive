// Injected at build time from apps/worker/package.json (vite.config.ts).
declare const __HIVE_VERSION__: string;
export const VERSION: string = typeof __HIVE_VERSION__ === "string" ? __HIVE_VERSION__ : "dev";
