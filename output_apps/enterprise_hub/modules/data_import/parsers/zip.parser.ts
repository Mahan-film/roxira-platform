/**
 * تجزیهٔ بستهٔ ZIP شامل فایل‌های CSV/XLSX.
 *
 * هر فایل CSV/XLSX یک «جدول» با نام همان فایل می‌شود. پیش از ازفشرده‌سازی،
 * فهرست مرکزی ZIP خوانده و دو گارد اعمال می‌شود: حداکثر ۵۰ فایل و حداکثر
 * ۲۰۰ مگابایت حجم باز. حجم باز هنگام ازفشرده‌سازی «واقعاً» اندازه‌گیری می‌شود
 * (ضد بمب فشرده‌سازی)، نه فقط از روی اندازهٔ اعلام‌شده در هدر.
 */

import * as path from 'path';
import {
  PACKAGE_MAX_UNCOMPRESSED_BYTES,
  PACKAGE_MAX_ZIP_FILES,
  maxPackageRows,
} from '../constants/package-import.constants';
import { parseCsv } from './csv.parser';
import {
  InMemoryTableReader,
  ParsedPackage,
  PackageTableReader,
} from './package-source.types';
import { parseXlsx } from './xlsx.parser';
import {
  extractZipEntry,
  InflateBudget,
  listZipEntries,
  ZipEntry,
  ZipReadError,
} from './zip-reader';

/** خطای تجزیهٔ بستهٔ ZIP. */
export class ZipPackageError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_COMMENT_LENGTH = 0xffff;

/** یافتن امضای پایان فهرست مرکزی از انتهای بافر. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 22 - MAX_COMMENT_LENGTH);
  for (let pos = buffer.length - 22; pos >= earliest; pos -= 1) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) {
      return pos;
    }
  }
  return -1;
}

/** اعمال گاردهای ZIP: محدودیت تعداد فایل و حجم باز. */
export function assertZipWithinLimits(buffer: Buffer): number {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    throw new ZipPackageError('فایل ZIP معتبر نیست یا آسیب‌دیده است.');
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const offset = buffer.readUInt32LE(eocd + 16);

  if (count > PACKAGE_MAX_ZIP_FILES) {
    throw new ZipPackageError(
      `تعداد فایل‌های داخل ZIP بیش از ${PACKAGE_MAX_ZIP_FILES} است.`,
    );
  }

  let uncompressed = 0;
  let pos = offset;
  for (let index = 0; index < count; index += 1) {
    if (
      pos + 46 > buffer.length ||
      buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE
    ) {
      throw new ZipPackageError('فایل ZIP معتبر نیست یا آسیب‌دیده است.');
    }
    uncompressed += buffer.readUInt32LE(pos + 24);
    if (uncompressed > PACKAGE_MAX_UNCOMPRESSED_BYTES) {
      throw new ZipPackageError(
        'حجم بازِ فایل ZIP بیش از سقف مجاز (۲۰۰ مگابایت) است.',
      );
    }
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return count;
}

/** سقف طول نام جدول. */
const MAX_TABLE_NAME_LENGTH = 64;

/** نام جدول از مسیر فایل داخل ZIP؛ پاک‌سازی‌شده و بدون کاراکتر کنترلی/خطرناک. */
export function tableNameFromPath(entryName: string): string {
  const base = path.posix.basename(entryName.replace(/\\/g, '/'));
  const withoutExt = base.replace(/\.[^.]+$/, '');
  const cleaned = (withoutExt || base)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_ .-]/gu, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, MAX_TABLE_NAME_LENGTH);
  if (!cleaned || /^(__proto__|constructor|prototype)$/i.test(cleaned)) {
    return 'table';
  }
  return cleaned;
}

/** یکتا کردن نام جدول‌ها (دو فایل هم‌نام در پوشه‌های متفاوت). */
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = `${name.slice(0, MAX_TABLE_NAME_LENGTH - 4)}_${n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function toZipPackageError(error: unknown): ZipPackageError {
  if (error instanceof ZipReadError && error.code === 'too_large') {
    return new ZipPackageError(
      'حجم بازِ فایل ZIP بیش از سقف مجاز (۲۰۰ مگابایت) است.',
    );
  }
  if (error instanceof ZipReadError && error.code === 'unsupported') {
    return new ZipPackageError('روش فشرده‌سازی این ZIP پشتیبانی نمی‌شود.');
  }
  return new ZipPackageError('فایل ZIP معتبر نیست یا آسیب‌دیده است.');
}

/** تجزیهٔ بستهٔ ZIP به جداول صفحه‌ای. */
export function parseZipPackage(buffer: Buffer): ParsedPackage {
  assertZipWithinLimits(buffer);

  let entries: ZipEntry[];
  try {
    entries = listZipEntries(buffer);
  } catch (error) {
    throw toZipPackageError(error);
  }

  const budget: InflateBudget = { remaining: PACKAGE_MAX_UNCOMPRESSED_BYTES };
  const tables: PackageTableReader[] = [];
  const usedNames = new Set<string>();
  let totalRows = 0;
  const rowLimit = maxPackageRows();

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const lower = entry.name.toLowerCase();
    if (entry.name.endsWith('/')) {
      continue;
    }
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      continue;
    }

    let headers: string[];
    let rows: string[][];
    try {
      const data = extractZipEntry(buffer, entry, budget);
      if (lower.endsWith('.csv')) {
        const parsed = parseCsv(data.toString('utf8'));
        headers = parsed.headers;
        rows = parsed.rows;
      } else {
        const parsed = parseXlsx(data, undefined, budget);
        headers = parsed.headers;
        rows = parsed.rows;
      }
    } catch (error) {
      if (error instanceof ZipReadError) {
        throw toZipPackageError(error);
      }
      throw error;
    }

    totalRows += rows.length;
    if (totalRows > rowLimit) {
      throw new ZipPackageError(
        `حداکثر ${rowLimit} ردیف در هر بسته مجاز است.`,
      );
    }

    tables.push(
      new InMemoryTableReader(
        uniqueName(tableNameFromPath(entry.name), usedNames),
        headers,
        rows,
      ),
    );
  }

  if (tables.length === 0) {
    throw new ZipPackageError(
      'بستهٔ ZIP هیچ فایل CSV یا XLSX قابل خواندنی ندارد.',
    );
  }

  return {
    tables,
    relationships: [],
    close: () => {
      // جدول‌های درون‌حافظه‌ای منبع خارجی ندارند.
    },
  };
}
