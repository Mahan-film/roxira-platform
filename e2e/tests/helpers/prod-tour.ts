/**
 * Helpers for the production feature tour (tests/prod-feature-tour.spec.ts), written so the laptop's M1 gate
 * (and any other Playwright spec that needs a throwaway Roxira tenant) can reuse them.
 *
 * Safety rules baked in:
 *  - the tenant is always a brand-new one called "Roxira QA <date>" with an @example.invalid address;
 *  - a password is generated per run; TOUR_EMAIL / TOUR_PASSWORD only pre-seed the credentials of the NEW
 *    signup (they do not log in to an existing tenant). Nothing is written to the repo (tour-results/ is ignored);
 *  - every failure keeps a screenshot, the console errors and the failed /api requests.
 */
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const SESSION_KEY = 'roxira.auth.session';
export const BASE = (process.env.TOUR_BASE_URL || 'https://roxira.ir').replace(/\/$/, '');
export const OUT_DIR = path.resolve(__dirname, '../../tour-results');

export interface TourSession {
  raw: string;
  accessToken: string;
  email: string;
  password: string;
  organization: string;
}

/** YYYY-MM-DD in the Gregorian calendar (the API takes ISO dates). */
export function isoDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

export function freshCredentials(): { email: string; password: string; organization: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    email: process.env.TOUR_EMAIL || `qa-${Date.now()}@example.invalid`,
    password: process.env.TOUR_PASSWORD || `${crypto.randomBytes(9).toString('base64url')}Aa1!`,
    organization: `Roxira QA ${stamp}`,
  };
}

/** Sign up a new business through the public signup form (also exercises "creating a business"). */
export async function signUpThroughUi(page: Page, creds = freshCredentials()): Promise<TourSession> {
  await page.goto(`${BASE}/signup`);
  await page.locator('#pw-email').fill(creds.email);
  await page.locator('#pw-password').fill(creds.password);
  await page.locator('#pw-org').fill(creds.organization);
  await page.getByRole('button', { name: 'ساخت حساب' }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), SESSION_KEY);
  expect(raw, 'session stored after signup').toBeTruthy();
  const parsed = JSON.parse(raw as string) as { accessToken: string };
  return { raw: raw as string, accessToken: parsed.accessToken, ...creds };
}

/** Thin JSON client for /api/backend with the tenant's bearer token. `call` never throws on non-2xx. */
export class Api {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  async call<T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; body: T; text: string }> {
    const res = await this.request.fetch(`${BASE}/api/backend/${route.replace(/^\//, '')}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      data: body === undefined ? undefined : JSON.stringify(body),
      timeout: 60_000,
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON (csv / xlsx) */
    }
    return { status: res.status(), body: parsed, text };
  }

  async ok<T = any>(method: string, route: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, route, body);
    expect(r.status, `${method} ${route} -> ${r.status} ${r.text.slice(0, 400)}`).toBeLessThan(300);
    return r.body;
  }
}

export async function gotoApp(page: Page, route: string): Promise<void> {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

export async function installSession(page: Page, raw: string): Promise<void> {
  await page.context().addInitScript(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* about:blank */
      }
    },
    [SESSION_KEY, raw] as const,
  );
}

/** Console errors that are not product bugs. */
const BENIGN = [/favicon\.ico/i, /umami/i, /net::ERR_ABORTED/i, /Download the React DevTools/i];

export interface Findings {
  console: string[];
  network: string[];
}

/** Start collecting console errors and failed /api responses for a page. */
export function watchPage(page: Page): Findings {
  const findings: Findings = { console: [], network: [] };
  page.on('pageerror', (e) => findings.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!BENIGN.some((re) => re.test(t))) findings.console.push(t.slice(0, 500));
  });
  page.on('response', async (r) => {
    const url = r.url();
    if (r.status() < 400 || !/\/api\//.test(url)) return;
    let snippet = '';
    try {
      snippet = (await r.text()).slice(0, 300);
    } catch {
      /* body gone */
    }
    findings.network.push(`${r.request().method()} ${url.replace(BASE, '')} -> ${r.status()} ${snippet}`);
  });
  return findings;
}

/** On a failed test: screenshot + console + network errors go to e2e/tour-results/ and to the report. */
export async function recordFailure(page: Page, info: TestInfo, findings: Findings): Promise<void> {
  if (info.status === info.expectedStatus) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const slug = info.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
  const shot = path.join(OUT_DIR, `${slug}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
  const entry = {
    test: info.title,
    screenshot: path.relative(path.resolve(__dirname, '../../..'), shot),
    error: (info.error?.message || '').slice(0, 1500),
    console: findings.console,
    network: findings.network,
  };
  fs.appendFileSync(path.join(OUT_DIR, 'failures.jsonl'), JSON.stringify(entry) + '\n');
  await info.attach('failure.json', { body: JSON.stringify(entry, null, 2), contentType: 'application/json' });
}
