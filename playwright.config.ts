import { defineConfig, devices } from "@playwright/test";

const E2E_ORIGIN = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: E2E_ORIGIN,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"]
    }
  }],
  webServer: {
    command: "tsx tests/e2e/fixture-server.ts",
    url: `${E2E_ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      OPENAI_API_KEY: "e2e-disabled-no-provider-access",
      ASSISTANT_RELEASE_TARGET: "internal-pilot",
      ASSISTANT_V3_ENABLED: "true",
      API_RATE_LIMIT_MAX: "10000",
      LOG_LEVEL: "error"
    }
  }
});
