/**
 * تجزیهٔ فایل باینری SQLite با sql.js.
 *
 * پیش از هر کار، «سرصفحه» (SQLite format 3\0) و «تعداد صفحات اعلام‌شده» با
 * اندازهٔ واقعی فایل مقایسه می‌شود؛ فایل ناقص/آسیب‌دیده با پیام فارسی روشن رد
 * می‌شود (دقیقاً همان اتفاقی که برای فایل واقعی مالک افتاد).
 */

import { SQLITE_CORRUPTED_MESSAGE } from '../constants/package-import.constants';
import { parseNumber } from '../normaliser/normalise';
import { ParsedPackage } from './package-source.types';
import { buildPackageFromDatabase, loadSqlJs } from './sqljs-common';

/** خطای تجزیهٔ فایل SQLite (با پیام فارسی قابل نمایش). */
export class SqliteParseError extends Error {}

/** آیا بافر با سرصفحهٔ معتبر SQLite آغاز می‌شود؟ */
export function isSqliteHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 16 &&
    buffer.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000'
  );
}

/** اندازهٔ صفحهٔ دیتابیس از سرصفحه (۱ به‌معنای ۶۵۵۳۶). */
function pageSizeOf(buffer: Buffer): number {
  const raw = buffer.readUInt16BE(16);
  return raw === 1 ? 65536 : raw;
}

/**
 * بررسی سلامت ساختاری فایل پیش از دادن به sql.js:
 * سرصفحه درست + طول فایل حداقل به‌اندازهٔ تعداد صفحات اعلام‌شده.
 */
export function assertSqliteIntegrity(buffer: Buffer): void {
  if (!isSqliteHeader(buffer)) {
    throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
  }
  const pageSize = pageSizeOf(buffer);
  const pageCount = buffer.readUInt32BE(28);
  if (pageSize < 512 || pageCount <= 0) {
    throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
  }
  const declaredBytes = pageSize * pageCount;
  if (buffer.length < declaredBytes) {
    throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
  }
}

function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** ساخت دیتابیس از بافر با تبدیل هر خطا به خطای آسیب‌دیدگی. */
function createDatabase(
  SQL: Awaited<ReturnType<typeof loadSqlJs>>,
  buffer: Buffer,
): import('sql.js').Database {
  try {
    return new SQL.Database(toUint8Array(buffer));
  } catch {
    throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
  }
}

/** اجرای integrity_check و رد کردن دیتابیس ناسالم. */
function assertDatabaseSane(db: import('sql.js').Database): void {
  try {
    const integrity = db.exec('PRAGMA integrity_check');
    const first = integrity[0]?.values?.[0]?.[0];
    if (typeof first === 'string' && first.toLowerCase() !== 'ok') {
      throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
    }
  } catch (error) {
    db.close();
    if (error instanceof SqliteParseError) {
      throw error;
    }
    throw new SqliteParseError(SQLITE_CORRUPTED_MESSAGE);
  }
}

/** باز کردن یک دیتابیس SQLite باینری و بازگرداندن جداول صفحه‌ای. */
export async function openSqlite(buffer: Buffer): Promise<ParsedPackage> {
  assertSqliteIntegrity(buffer);

  const SQL = await loadSqlJs();
  const db = createDatabase(SQL, buffer);
  assertDatabaseSane(db);

  const { tables, relationships } = buildPackageFromDatabase(db);
  return {
    tables,
    relationships,
    close: () => db.close(),
  };
}

/** برای استفادهٔ تست: تلاش برای خواندن یک مقدار عددی از سلول. */
export function numericCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  return parseNumber(String(value));
}
