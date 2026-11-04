import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, fixturePath, openApp } from './fixtures';

/**
 * #277 / #282: the file picker on /app/import offers the formats the server reads (support matrix), and a
 * file that does not fit one request (production nginx caps /enterprise-hub/ at 16 MB) never goes up as one
 * request. With bulk import enabled it goes to the «ورود حجیم» panel in resumable parts and waits at the
 * review gate; without it, it goes up in chunks through the whole-database tab. Each case picks a file on
 * the single-file tab and must reach a review step without an error. Nothing is committed.
 */
test.use({ sessionKind: 'import' });

const FORMATS = path.resolve(__dirname, '../../output_apps/enterprise_hub/modules/data_import/__fixtures__/formats');
const MB = 1024 * 1024;

/** A synthetic parties CSV just over 16 MB (about 140k rows, under the 200k row limit). */
function bigCsv(dir: string): string {
  const file = path.join(dir, 'parties-17mb.csv');
  const rows = ['code,name,phone,city,note'];
  let size = rows[0].length + 1;
  for (let i = 1; size <= 17 * MB; i += 1) {
    const row = `P${String(i).padStart(6, '0')},مشتری نمونه ${i},0912${String(i % 10_000_000).padStart(7, '0')},تهران,ردیف ساختگی برای آزمون بارگذاری تکه‌ای`;
    rows.push(row);
    size += Buffer.byteLength(row) + 1;
  }
  fs.writeFileSync(file, rows.join('\n') + '\n');
  return file;
}

/** Copy a fixture under the extension a user's file would have (the repo keeps dumps as .sql.txt). */
function asFile(dir: string, source: string, name: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(source, file);
  return file;
}

async function pickOnFileTab(page: Page, file: string): Promise<void> {
  let singleRequest = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/data-import\/preview$/.test(request.url())) singleRequest = true;
  });
  await openApp(page, '/app/import');
  const input = page.locator('#import-file');
  // The picker offers what the server reads, from GET /data-import/formats.
  await expect(input).toHaveAttribute('accept', /\.sql(,|$)/);
  await expect(input).toHaveAttribute('accept', /\.sqlite(,|$)/);
  await input.setInputFiles(file);

  // Bulk panel (job ready for review) or whole-database tab (analysis shown): either is the preview.
  const bulkReview = page.getByRole('button', { name: 'بازبینی و ثبت' });
  const packageReview = page.getByRole('button', { name: /تأیید و انتقال/ });
  await expect(bulkReview.or(packageReview).first()).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('انتقال دیتابیس انجام نشد')).toHaveCount(0);
  await expect(page.getByText('ورود حجیم انجام نشد')).toHaveCount(0);
  expect(singleRequest, 'the file must not go up as one request').toBe(false);
}

test.describe('import formats and sizes (#277)', () => {
  let dir: string;
  test.beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-import-277-'));
  });
  test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a CSV over 16 MB goes up in parts and reaches the review', async ({ page }) => {
    test.setTimeout(300_000);
    const file = bigCsv(dir);
    expect(fs.statSync(file).size).toBeGreaterThan(16 * MB);
    await pickOnFileTab(page, file);
  });

  test('a MySQL .sql dump is read (never executed) and reaches the review', async ({ page }) => {
    test.setTimeout(180_000);
    await pickOnFileTab(page, asFile(dir, path.join(FORMATS, 'mysql-dump.sql.txt'), 'shop-dump.sql'));
  });

  test('a .sqlite database reaches the review', async ({ page }) => {
    test.setTimeout(180_000);
    await pickOnFileTab(page, fixturePath());
  });
});
