import { defineConfig } from "@playwright/test";

// MV3 extension e2e. Requires a prior `npm run build` (loads ./dist) and
// Playwright's chromium (`npx playwright install chromium`).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false, // persistent contexts don't parallelize safely
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0, // absorb rare SW-restart flakiness
  reporter: process.env.CI ? "github" : "list",
});
