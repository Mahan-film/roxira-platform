/**
 * ثابت‌های «ورود بستهٔ دیتابیس» (Database package import).
 *
 * مشتری یک فایل کامل از نرم‌افزار قبلی خود (SQLite، دامپ SQL، یا ZIP از
 * CSV/XLSX) بارگذاری می‌کند و کل شرکت را یکجا به روکسیرا مهاجرت می‌دهد.
 */

import * as os from 'os';
import * as path from 'path';

/** نام صف BullMQ برای تحلیل و ثبت بسته. */
export const PACKAGE_QUEUE_NAME = 'package-import';

/** نام کار تحلیل بسته (package analyze). */
export const PACKAGE_ANALYZE_JOB = 'package-analyze';

/** نام کار ثبت نهایی بسته (package commit). */
export const PACKAGE_COMMIT_JOB = 'package-commit';

/** سقف پیش‌فرض حجم بسته: ۴۰ مگابایت. */
export const DEFAULT_MAX_PACKAGE_BYTES = 40 * 1024 * 1024;

/** سقف پیش‌فرض تعداد ردیف هر بسته: ۲۰۰٬۰۰۰. */
export const DEFAULT_MAX_PACKAGE_ROWS = 200000;

/** اندازه هر صفحه خواندن جدول (کران‌دار نگه‌داشتن حافظه). */
export const PACKAGE_PAGE_SIZE = 2000;

/** تعداد ردیف نمونه برای تشخیص موجودیت. */
export const PACKAGE_SAMPLE_ROWS = 20;

/** تعداد نمونه مقدار هر ستون در خروجی تحلیل. */
export const PACKAGE_COLUMN_SAMPLE = 3;

/** مدت نگه‌داری فایل و وضعیت بسته: ۲ ساعت. */
export const PACKAGE_TTL_MS = 2 * 60 * 60 * 1000;

/** سقف حجم بازِ آرشیو ZIP (ضد بمب فشرده‌سازی): ۲۰۰ مگابایت. */
export const PACKAGE_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/** حداکثر تعداد فایل داخل یک ZIP. */
export const PACKAGE_MAX_ZIP_FILES = 50;

/** نسبت پوشش لازم برای استنباط رابطه بین جداول. */
export const PACKAGE_RELATIONSHIP_THRESHOLD = 0.95;

/** حداکثر خطاهای گزارش‌شده در progress. */
export const PACKAGE_MAX_ERRORS = 50;

/** پیام فارسی یکسان برای دیتابیس آسیب‌دیده/ناقص. */
export const SQLITE_CORRUPTED_MESSAGE =
  'فایل دیتابیس آسیب دیده است؛ اگر نسخه .sql یا CSV دارید آن را بفرستید';

/** پسوندهای مجاز بستهٔ دیتابیس. */
export const PACKAGE_UPLOAD_EXTENSIONS = [
  '.sqlite',
  '.sqlite3',
  '.db',
  '.sql',
  '.zip',
] as const;

/** ترتیب وابستگی درج موجودیت‌ها هنگام commit. */
export const PACKAGE_ENTITY_ORDER = [
  'accounting-accounts',
  'crm-leads',
  'inventory-items',
  'sales-invoices',
  'accounting-journal-lines',
  'crm-activities',
] as const;

function readPositiveLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** سقف حجم بسته بر پایه `IMPORT_MAX_PACKAGE_BYTES`. */
export function maxPackageBytes(): number {
  return readPositiveLimit('IMPORT_MAX_PACKAGE_BYTES', DEFAULT_MAX_PACKAGE_BYTES);
}

/** سقف تعداد ردیف بسته (مشترک با `IMPORT_MAX_ROWS`). */
export function maxPackageRows(): number {
  return readPositiveLimit('IMPORT_MAX_ROWS', DEFAULT_MAX_PACKAGE_ROWS);
}

/** ریشه پوشه موقت بسته‌ها (`IMPORT_TMP_DIR` با پیش‌فرض tmp/roxira-import). */
export function packageTmpRoot(): string {
  const raw = process.env.IMPORT_TMP_DIR;
  if (raw && raw.trim()) {
    return raw;
  }
  return path.join(os.tmpdir(), 'roxira-import');
}
