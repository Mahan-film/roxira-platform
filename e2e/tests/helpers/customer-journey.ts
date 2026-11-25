import { expect, type Page, type TestInfo } from '@playwright/test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const SESSION_KEY = 'roxira.auth.session';
export const BASE = (process.env.APP_E2E_BASE_URL || process.env.TOUR_BASE_URL || 'http://127.0.0.1:3901').replace(/\/$/, '');
export const OUT_DIR = path.resolve(__dirname, '../../journey-results');

export interface JourneyCredentials {
  email: string;
  password: string;
  organization: string;
  economicCode: string;
  nationalId: string;
  inviteeEmail: string;
  inviteeRole: string;
  customerName: string;
  itemName: string;
  itemQty: number;
  unitPrice: number;
  paymentAmount: number;
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

export function generateSyntheticCustomer(suffix = uniqueSuffix()): JourneyCredentials {
  return {
    email: `customer-${suffix}@example.invalid`,
    password: `Pass${suffix}123!Aa`,
    organization: `شرکت آزمایشی سفر ${suffix}`,
    economicCode: '411234567890',
    nationalId: '10101234567',
    inviteeEmail: `colleague-${suffix}@example.invalid`,
    inviteeRole: 'sales',
    customerName: `مشتری خریدار ${suffix}`,
    itemName: `کالای آزمایشی ${suffix}`,
    itemQty: 2,
    unitPrice: 500_000,
    paymentAmount: 1_000_000,
  };
}

export interface JourneyFindings {
  console: string[];
  network: string[];
}

const BENIGN = [
  /favicon\.ico/i,
  /umami/i,
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
  /Failed to load resource: net::ERR_CONNECTION_REFUSED/i,
];

export function watchJourneyPage(page: Page): JourneyFindings {
  const findings: JourneyFindings = { console: [], network: [] };
  page.on('pageerror', (e) => findings.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN.some((re) => re.test(text))) {
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

export async function recordJourneyFailure(
  page: Page,
  info: TestInfo,
  stepName: string,
  findings: JourneyFindings,
): Promise<string> {
  fs.mkdirSync(path.join(OUT_DIR, 'screenshots'), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = stepName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);
  const shotPath = path.join(OUT_DIR, 'screenshots', `${slug}-${timestamp}.png`);

  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);

  const issueMarkdown = [
    `### Bug in First-Customer Journey: ${stepName}`,
    `**URL**: \`${page.url()}\``,
    `**Step**: ${stepName}`,
    `**Error**: ${info.error?.message || 'Step assertion failed'}`,
    findings.console.length > 0 ? `**Console Errors**:\n\`\`\`\n${findings.console.join('\n')}\n\`\`\`` : '',
    findings.network.length > 0 ? `**Failed Network Calls**:\n\`\`\`\n${findings.network.join('\n')}\n\`\`\`` : '',
    `**Screenshot**: \`${path.relative(process.cwd(), shotPath)}\``,
    `\n**Steps to Reproduce**:\n1. Execute first-customer journey up to step "${stepName}".\n2. Observe failure in UI / API response.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const issueEntry = {
    title: `[QA Bug] First-Customer Journey failed at: ${stepName}`,
    step: stepName,
    url: page.url(),
    error: info.error?.message,
    console: findings.console,
    network: findings.network,
    screenshot: shotPath,
    markdown: issueMarkdown,
  };

  fs.appendFileSync(path.join(OUT_DIR, 'bugs.jsonl'), JSON.stringify(issueEntry) + '\n');
  fs.appendFileSync(path.join(OUT_DIR, 'bugs.md'), `\n---\n\n${issueMarkdown}\n`);

  return issueMarkdown;
}

export function createSmallSyntheticCsv(creds: JourneyCredentials): string {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `synthetic-customers-${Date.now()}.csv`);
  const content = [
    'کد,نام,نوع,شناسه ملی,کد اقتصادی',
    `CUST-001,${creds.customerName},مشتری,10101234567,411234567890`,
    `CUST-002,شرکت همکاران دوم,مشتری,10109876543,411987654321`,
    `SUPP-001,تأمین‌کننده کالای اولیه,تأمین‌کننده,10105555555,411555555555`,
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}
