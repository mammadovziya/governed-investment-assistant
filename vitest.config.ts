import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**", "tests/e2e/**"],
    setupFiles: ["./tests/setup-offline.ts"],
    // Runtime and production-bootstrap suites intentionally exercise complete
    // workflow/server lifecycles. Bound worker pressure so CI does not turn
    // their fail-closed dependency timeouts into scheduling flakes.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
});
