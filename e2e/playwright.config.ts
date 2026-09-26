import { defineConfig, devices } from '@playwright/test';

/**
 * Read-only production smoke tests. No secrets, no writes: payments/pricing-matrix (read-only)
 * only ever creates a sandbox invoice record and chat costs exactly one LLM call
 * per full run (see tests/chat.spec.ts).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://ghazihoushmand.ir',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
