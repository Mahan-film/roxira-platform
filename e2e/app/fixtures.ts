import { test as base, expect, type JSHandle, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** localStorage key the frontend reads its session from (src/lib/api/auth-client.ts). */
export const SESSION_STORAGE_KEY = 'roxira.auth.session';

/**
 * Which sandbox tenant a spec runs as:
 *  - 'seeded' (default): a tenant pre-loaded with the data_import fixture; shared, treat as read-mostly.
 *  - 'import': a fresh, empty tenant per browser project, for specs that import data through the UI.
 */
export type SessionKind = 'seeded' | 'import';

function sessionFileFor(kind: SessionKind, projectName: string): string {
  const env = process.env;
  const file =
    (kind === 'import' ? env[`APP_E2E_SESSION_FILE_IMPORT_${projectName.toUpperCase()}`] : undefined) ??
    env.APP_E2E_SESSION_FILE;
  if (!file) {
    throw new Error(
      'APP_E2E_SESSION_FILE is not set. Start the sandbox with scripts/infra/e2e/sandbox_up.sh and source ' +
        '$TMPDIR/rxtest/out/app_e2e.env (or run scripts/infra/e2e/run_app_e2e.sh).',
    );
  }
  return file;
}

/** Path of the .sqlite fixture to upload (APP_E2E_FIXTURE, else the one committed in the repo). */
export function fixturePath(): string {
  return (
    process.env.APP_E2E_FIXTURE ??
    path.resolve(__dirname, '../../output_apps/enterprise_hub/modules/data_import/__fixtures__/erp_multicurrency_small.sqlite')
  );
}

/**
 * Console errors that are NOT bugs. Keep this list short and specific: every entry hides a class of failure.
 * Anything else logged with console.error (including failed-resource lines such as a 400 from the API) fails
 * the test, because that is exactly how real regressions like the HR contracts 400 show up.
 */
export const BENIGN_CONSOLE_ERRORS: RegExp[] = [
  /favicon\.ico/i, // no favicon in the sandbox build
  /umami/i, // analytics script is intentionally empty/blocked in the sandbox
  /net::ERR_ABORTED/i, // fetches cancelled by an AbortController on unmount/navigation
  /Download the React DevTools/i,
];

interface Fixtures {
  sessionKind: SessionKind;
  /** Problems collected from the page (uncaught errors, console errors); asserted empty after each test. */
  pageProblems: string[];
}

export const test = base.extend<Fixtures>({
  sessionKind: ['seeded', { option: true }],

  pageProblems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
  },

  context: async ({ context, sessionKind }, use, testInfo) => {
    const file = sessionFileFor(sessionKind, testInfo.project.name);
    const raw = fs.readFileSync(file, 'utf8');
    const session = JSON.parse(raw) as { accessToken?: unknown; expiresAt?: unknown };
    if (typeof session.accessToken !== 'string') throw new Error(`${file} has no accessToken`);
    if (typeof session.expiresAt === 'number' && session.expiresAt < Date.now()) {
      throw new Error(`${file} is expired; re-run sandbox_up.sh`);
    }
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* storage unavailable on about:blank */
        }
      },
      [SESSION_STORAGE_KEY, raw] as const,
    );
    await use(context);
  },

  // Global guard: fail any test on an uncaught page error or an unexpected console error.
  page: async ({ page, pageProblems }, use) => {
    page.on('pageerror', (error) => {
      pageProblems.push(`uncaught page error: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (BENIGN_CONSOLE_ERRORS.some((re) => re.test(text))) return;
      pageProblems.push(`console.error: ${text}${message.location().url ? ` (${message.location().url})` : ''}`);
    });
    await use(page);
    expect(pageProblems, 'uncaught page errors / unexpected console errors').toEqual([]);
  },
});

export { expect };

/** Build a DataTransfer inside the page (optionally carrying one file read from disk). */
export async function makeDataTransfer(page: Page, file?: string): Promise<JSHandle<DataTransfer>> {
  const payload = file
    ? { name: path.basename(file), base64: fs.readFileSync(file).toString('base64') }
    : { name: '', base64: '' };
  return page.evaluateHandle(({ name, base64 }) => {
    const dt = new DataTransfer();
    if (name) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], name, { type: 'application/octet-stream' }));
    }
    return dt;
  }, payload);
}

/** Dispatch a drag event carrying a file onto a locator (what a browser does when a file is dragged in). */
export async function dragEventWithFile(
  page: Page,
  target: Locator,
  type: 'dragenter' | 'dragover' | 'drop',
  file: string,
): Promise<void> {
  const dataTransfer = await makeDataTransfer(page, file);
  await target.dispatchEvent(type, { dataTransfer });
  await dataTransfer.dispose();
}

/** Persian-digit rendering used by the UI for counts (Intl fa-IR with grouping). */
export function fa(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

/** «۱٬۲۰۰ ریال» -> 1200 (first number in the text; NaN when there is none). */
export function parseFa(text: string): number {
  const digits = text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٬,\s]/g, '');
  const match = digits.match(/\d+/);
  return match ? Number(match[0]) : Number.NaN;
}

/** Open an /app route and wait until the route guard has resolved (no more «در حال بررسی دسترسی»). */
export async function openApp(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  // The sidebar is rendered only once the route guard let the shell through (aria-label «منوی نرم‌افزار»).
  await expect(page.getByRole('navigation', { name: /منوی نرم.?افزار/ })).toBeVisible();
  await expect(page.getByText('در حال بررسی دسترسی')).toHaveCount(0);
}

/** Assert that no destructive error notice (Alert role="alert", e.g. ErrorNotice) is visible on the page. */
export async function expectNoErrorNotice(page: Page): Promise<void> {
  // Next's route announcer also has role="alert" but is empty; only count alerts that carry text.
  const alerts = page.locator('[role="alert"]').filter({ hasText: /\S/ });
  await expect(alerts, 'no error notice on the page').toHaveCount(0);
}
