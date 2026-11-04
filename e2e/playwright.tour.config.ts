import { defineConfig, devices } from '@playwright/test';

/**
 * Opt-in production feature tour (tests/prod-feature-tour.spec.ts). Creates a throwaway "Roxira QA <date>"
 * tenant on production; never run it against a tenant that holds real data.
 *
 *   PROD_TOUR=1 npx playwright test -c playwright.tour.config.ts
 *   TOUR_BASE_URL=https://roxira.ir (default)
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /prod-feature-tour\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'tour-results/report.json' }]],
  outputDir: 'tour-results/artifacts',
  use: {
    baseURL: process.env.TOUR_BASE_URL || 'https://roxira.ir',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
