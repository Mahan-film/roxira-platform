import * as path from 'node:path';
import { expect, type Page } from '@playwright/test';

import { fa, openApp, parseFa, SESSION_STORAGE_KEY } from '../../app/fixtures';
import { readCsv } from './fixture-data';

/**
 * Drivers for the M1 gate import steps: the real /app/import file wizard (pick a file, map the columns,
 * commit) and read-only API calls with the session of the test tenant.
 *
 * Expected values never come from here: they come from the fixture files and README totals.
 */

export interface ImportCounts {
  inserted: number;
  skippedDuplicates: number;
  failed: number;
}

/**
 * Upload `file` in the «ورود فایل» wizard as `entityKey` with an explicit column mapping and commit it.
 * `mapping` names a registry field for every column of the file, or null for «— نادیده گرفتن —»; the
 * helper fails if the file has a column the mapping does not mention, so nothing is mapped by accident.
 */
export async function importFile(
  page: Page,
  file: string,
  entityKey: string,
  mapping: Record<string, string | null>,
): Promise<ImportCounts> {
  await openApp(page, '/app/import');
  const { header, rows } = readCsv(file);
  expect(Object.keys(mapping).sort(), `mapping covers every column of ${path.basename(file)}`).toEqual(
    [...header].sort(),
  );

  await page.locator('#import-file').setInputFiles(file);
  const entitySelect = page.getByLabel('نوع داده', { exact: true });
  await expect(entitySelect).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`${path.basename(file)} — ${fa(rows.length)} ردیف`)).toBeVisible();

  if ((await entitySelect.inputValue()) !== entityKey) {
    await entitySelect.selectOption(entityKey);
    await expect(entitySelect).toBeEnabled({ timeout: 60_000 });
  }
  await expect(entitySelect).toHaveValue(entityKey);

  for (const column of header) {
    const target = page.getByLabel(`فیلد مقصد برای ${column}`, { exact: true });
    await expect(target).toBeEnabled();
    await target.selectOption(mapping[column] ?? '');
  }

  // Nothing may be flagged before the commit: no missing required field, no field mapped twice.
  await expect(page.getByText('فیلدهای الزامی بدون ستون')).toHaveCount(0);
  await expect(page.getByText('یک فیلد مقصد فقط می‌تواند به یک ستون وصل شود.')).toHaveCount(0);

  const commit = page.getByRole('button', { name: `تأیید و ثبت ${fa(rows.length)} ردیف` });
  await expect(commit).toBeEnabled();
  await commit.click();

  await expect(page.getByText('ورود داده انجام شد')).toBeVisible({ timeout: 120_000 });
  const count = async (label: string) => {
    // The number is the sibling just above its label inside one tile.
    const number = page.getByText(label, { exact: true }).locator('xpath=preceding-sibling::div[1]');
    return parseFa(await number.innerText());
  };
  return {
    inserted: await count('ثبت‌شده'),
    skippedDuplicates: await count('تکراری (رد شد)'),
    failed: await count('ناموفق'),
  };
}

/** GET /enterprise-hub/<path> through the app's own proxy, authenticated as the test tenant's owner. */
export async function apiGet<T>(page: Page, route: string): Promise<T> {
  const token = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
  }, SESSION_STORAGE_KEY);
  expect(token, 'the test session is in localStorage').toBeTruthy();
  const response = await page.request.get(`/api/backend/enterprise-hub/${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), `GET ${route}`).toBe(200);
  return (await response.json()) as T;
}

/** PATCH /enterprise-hub/<route> with a JSON body through the app's own proxy (test tenant's owner). */
export async function apiPatch<T>(page: Page, route: string, body: unknown): Promise<T> {
  const token = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
  }, SESSION_STORAGE_KEY);
  expect(token, 'the test session is in localStorage').toBeTruthy();
  const response = await page.request.patch(`/api/backend/enterprise-hub/${route}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  expect(response.status(), `PATCH ${route}`).toBe(200);
  return (await response.json()) as T;
}

export interface InvoicePostingResult {
  status: string;
  journalEntryId: number | null;
  postingError: string | null;
  finalPayable: number;
}

/**
 * Issues one invoice through the real API (`PATCH invoicing/:id` with status ISSUED) and waits for the
 * asynchronous posting (a `suite-events` job) to finish: polls `GET invoicing/:id` every 250 ms for up
 * to 30 s until `journalEntryId` or `postingError` appears. Fails with the invoice number and error.
 * Call strictly one at a time so FIFO order holds.
 */
export async function issueAndWait(
  page: Page,
  invoiceId: string,
  invoiceNumber: string,
): Promise<InvoicePostingResult> {
  await apiPatch(page, `invoicing/${invoiceId}`, { status: 'ISSUED' });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const invoice = await apiGet<InvoicePostingResult>(page, `invoicing/${invoiceId}`);
    if (invoice.journalEntryId !== null || invoice.postingError !== null) {
      if (invoice.postingError !== null) {
        throw new Error(`invoice ${invoiceNumber}: posting failed: ${invoice.postingError}`);
      }
      return invoice;
    }
    if (Date.now() > deadline) {
      throw new Error(`invoice ${invoiceNumber}: no voucher and no error 30 s after issuing`);
    }
    await page.waitForTimeout(250);
  }
}

/** API money (a JSON number, or a decimal string) -> integer rials. A fraction other than .00 is an error. */
export function rials(value: number | string): bigint {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] && /[1-9]/.test(match[2]))) throw new Error(`not whole rials: ${String(value)}`);
  return BigInt(match[1]);
}

/** Arabic ي/ك -> Persian ی/ک, the importer's documented text normalisation, restated here independently. */
export function persianise(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
}
