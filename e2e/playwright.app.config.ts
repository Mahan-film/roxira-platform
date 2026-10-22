import { defineConfig, devices } from '@playwright/test';

/**
 * Gate 3 browser suite for the business app (/app/*), run in Chromium AND WebKit (the owner uses Safari).
 * Runs against the throwaway sandbox built by scripts/infra/e2e/sandbox_up.sh, never against production:
 * these specs create and import data.
 *
 *   APP_E2E_BASE_URL              frontend origin (default http://127.0.0.1:3901). Use 127.0.0.1, not a
 *                                 production hostname: the Next middleware redirects /app on other hosts.
 *   APP_E2E_SESSION_FILE          session JSON (localStorage "roxira.auth.session") of the seeded tenant
 *   APP_E2E_SESSION_FILE_IMPORT_<PROJECT>   per-browser fresh tenant for the import specs (CHROMIUM / WEBKIT);
 *                                 falls back to APP_E2E_SESSION_FILE
 *   APP_E2E_FIXTURE               the .sqlite fixture to upload
 *
 * Specs are numbered and run serially (workers: 1); each browser project gets its own import tenant, so the
 * two projects never collide on duplicate detection.
 */
export default defineConfig({
  testDir: './app',
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'app-report' }]],
  outputDir: 'app-results',
  use: {
    baseURL: process.env.APP_E2E_BASE_URL || 'http://127.0.0.1:3901',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
