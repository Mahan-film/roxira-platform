import { expect, type Page, type TestInfo } from '@playwright/test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const SESSION_KEY = 'roxira.auth.session';
export const BASE = (
  process.env.APP_E2E_BASE_URL ||
  process.env.E2E_BASE_URL ||
  process.env.TOUR_BASE_URL ||
  'http://127.0.0.1:3901'
).replace(/\/$/, '');

export const SMOKE_OUT_DIR = path.resolve(__dirname, '../../smoke-results');

export interface SmokeCredentials {
  email: string;
  password: string;
  organization: string;
  nationalId: string;
  mobile: string;
  sku: string;
  barcode: string;
  itemName: string;
  invoiceNumber: string;
  customerName: string;
  employeeFirstName: string;
  employeeLastName: string;
  leadName: string;
  leadCompany: string;
  inviteEmail: string;
  suffix: string;
}

export function uniqueSmokeSuffix(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * Generates a mathematically valid 10-digit Iranian National ID (کد ملی).
 * Prevents schema and server-side checksum failures on national identity fields.
 */
export function generateValidNationalId(): string {
  // Generate first 9 digits (avoiding 10 identical digits which are invalid in Iran)
  const prefix = String(Math.floor(100_000_000 + Math.random() * 800_000_000));
  const digits = prefix.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (10 - i), 0);
  const remainder = sum % 11;
  const checkDigit = remainder < 2 ? remainder : 11 - remainder;
  return `${prefix}${checkDigit}`;
}

export function generateModuleSmokeData(suffix = uniqueSmokeSuffix()): SmokeCredentials {
  return {
    suffix,
    email: `smoke-${suffix}@example.invalid`,
    password: `Pass${suffix}123!Aa`,
    organization: `شرکت آزمون ماژول ${suffix}`,
    nationalId: generateValidNationalId(),
    mobile: `0912${String(Math.floor(1000000 + Math.random() * 9000000))}`,
    sku: `SKU-${suffix}`,
    barcode: `BAR-${suffix}`,
    itemName: `کالای دود ${suffix}`,
    invoiceNumber: `INV-SMK-${suffix.toUpperCase()}`,
    customerName: `مشتری آزمایشی ${suffix}`,
    employeeFirstName: 'مهدی',
    employeeLastName: `تست‌زاده ${suffix}`,
    leadName: `سرنخ آزمایشی ${suffix}`,
    leadCompany: `سازمان نمونه ${suffix}`,
    inviteEmail: `invite-${suffix}@example.invalid`,
  };
}

export interface SmokeFindings {
  console: string[];
  network: string[];
}

const BENIGN_ERRORS = [
  /favicon\.ico/i,
  /umami/i,
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED/i,
];

export function watchSmokePage(page: Page): SmokeFindings {
  const findings: SmokeFindings = { console: [], network: [] };
  page.on('pageerror', (e) => findings.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_ERRORS.some((re) => re.test(text))) {
      findings.console.push(text.slice(0, 500));
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (res.status() < 400 || !/\/api\//.test(url)) return;
    let snippet = '';
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      /* body consumed */
    }
    findings.network.push(`${res.request().method()} ${url.replace(BASE, '')} -> ${res.status()} ${snippet}`);
  });
  return findings;
}

export async function recordSmokeFailure(
  page: Page,
  info: TestInfo,
  moduleName: string,
  stepName: string,
  findings: SmokeFindings,
): Promise<string> {
  fs.mkdirSync(path.join(SMOKE_OUT_DIR, 'screenshots'), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = `${moduleName}-${stepName}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
  const shotPath = path.join(SMOKE_OUT_DIR, 'screenshots', `${slug}-${timestamp}.png`);

  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);

  const issueMarkdown = [
    `### [QA Bug] Module Smoke Test Failure: ${moduleName} - ${stepName}`,
    `**Module**: \`${moduleName}\``,
    `**URL**: \`${page.url()}\``,
    `**Step**: ${stepName}`,
    `**Error**: ${info.error?.message || 'Step assertion failed'}`,
    findings.console.length > 0 ? `**Console Errors**:\n\`\`\`\n${findings.console.join('\n')}\n\`\`\`` : '',
    findings.network.length > 0 ? `**Failed Network Calls**:\n\`\`\`\n${findings.network.join('\n')}\n\`\`\`` : '',
    `**Screenshot**: \`${path.relative(process.cwd(), shotPath)}\``,
    `\n**Steps to Reproduce**:\n1. Open module \`${moduleName}\` on localhost.\n2. Execute smoke step: "${stepName}".\n3. Observe failure.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const issueEntry = {
    title: `[QA Bug] Smoke test failed in ${moduleName}: ${stepName}`,
    module: moduleName,
    step: stepName,
    url: page.url(),
    error: info.error?.message,
    console: findings.console,
    network: findings.network,
    screenshot: shotPath,
    markdown: issueMarkdown,
  };

  fs.appendFileSync(path.join(SMOKE_OUT_DIR, 'bugs.jsonl'), JSON.stringify(issueEntry) + '\n');
  fs.appendFileSync(path.join(SMOKE_OUT_DIR, 'bugs.md'), `\n---\n\n${issueMarkdown}\n`);

  return issueMarkdown;
}

/**
 * Ensures authenticated session for smoke testing:
 * 1. If APP_E2E_SESSION_FILE exists, injects token directly into localStorage.
 * 2. If token already in localStorage, proceeds to /app.
 * 3. Otherwise registers a synthetic tenant through /signup.
 */
export async function ensureSmokeAuth(page: Page, creds: SmokeCredentials): Promise<void> {
  const sessionEnvFile = process.env.APP_E2E_SESSION_FILE || process.env.APP_E2E_SESSION_FILE_M1;
  if (sessionEnvFile && fs.existsSync(sessionEnvFile)) {
    try {
      const raw = fs.readFileSync(sessionEnvFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.accessToken) {
        await page.goto(`${BASE}/app`, { waitUntil: 'commit' }).catch(() => undefined);
        await page.evaluate(
          ([k, v]) => window.localStorage.setItem(k, v),
          [SESSION_KEY, raw] as const,
        );
        await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
        return;
      }
    } catch {
      // Fallback to signup
    }
  }

  // Check if session already exists
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const hasToken = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    try {
      return Boolean((JSON.parse(raw) as { accessToken?: string }).accessToken);
    } catch {
      return false;
    }
  }, SESSION_KEY);

  if (hasToken && !page.url().includes('/login') && !page.url().includes('/signup')) {
    return;
  }

  // Register synthetic user
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pw-email')).toBeVisible({ timeout: 20_000 });
  await page.locator('#pw-email').fill(creds.email);
  await page.locator('#pw-password').fill(creds.password);
  await page.locator('#pw-org').fill(creds.organization);
  await page.getByRole('button', { name: 'ساخت حساب' }).click();

  await page.waitForURL(/\/app/, { timeout: 35_000 });

  // Handle onboarding wizard if present
  if (page.url().includes('/app/onboarding')) {
    const nameInput = page.getByLabel('نام شرکت');
    if (await nameInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await nameInput.fill(creds.organization);
      await page.getByLabel(/شماره اقتصادی/).fill('411234567890');
      await page.getByLabel(/شناسه ملی/).fill(creds.nationalId);
      await page.getByRole('button', { name: /ذخیره و ادامه/ }).click();
    }
    const fiscalYearBtn = page.getByRole('button', { name: /ایجاد سال مالی|ذخیره و ادامه/ });
    if (await fiscalYearBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await fiscalYearBtn.click();
    }
    const applyChartBtn = page.getByRole('button', { name: /اعمال قالب|ذخیره و ادامه/ });
    if (await applyChartBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await applyChartBtn.click();
    }
  }
}
