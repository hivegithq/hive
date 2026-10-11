import { defineConfig } from "vitest/config";

// Unit tests cover pure logic (overlap, queue, policy); they don't need the Workers runtime.
export default defineConfig({
	test: { include: ["src/**/*.test.ts"] },
});
