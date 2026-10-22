/**
 * تجزیهٔ بستهٔ ZIP شامل فایل‌های CSV/XLSX.
 *
 * هر فایل CSV/XLSX یک «جدول» با نام همان فایل می‌شود. پیش از ازفشرده‌سازی،
 * فهرست مرکزی ZIP خوانده و دو گارد اعمال می‌شود: حداکثر ۵۰ فایل و حداکثر
 * ۲۰۰ مگابایت حجم باز (ضد بمب فشرده‌سازی).
 */

import * as path from 'path';
import { unzipSync } from 'fflate';
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

/** نام جدول از مسیر فایل داخل ZIP (نام فایل بدون پسوند). */
function tableNameFromPath(entryName: string): string {
  const base = path.posix.basename(entryName.replace(/\\/g, '/'));
  const withoutExt = base.replace(/\.[^.]+$/, '');
  return withoutExt || base || 'table';
}

/** تجزیهٔ بستهٔ ZIP به جداول صفحه‌ای. */
export function parseZipPackage(buffer: Buffer): ParsedPackage {
  assertZipWithinLimits(buffer);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  } catch {
    throw new ZipPackageError('فایل ZIP معتبر نیست یا آسیب‌دیده است.');
  }

  const tables: PackageTableReader[] = [];
  let totalRows = 0;
  const rowLimit = maxPackageRows();

  for (const entryName of Object.keys(files).sort()) {
    const lower = entryName.toLowerCase();
    if (entryName.endsWith('/')) {
      continue;
    }
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      continue;
    }

    const data = files[entryName];
    let headers: string[];
    let rows: string[][];
    if (lower.endsWith('.csv')) {
      const parsed = parseCsv(Buffer.from(data).toString('utf8'));
      headers = parsed.headers;
      rows = parsed.rows;
    } else {
      const parsed = parseXlsx(Buffer.from(data));
      headers = parsed.headers;
      rows = parsed.rows;
    }

    totalRows += rows.length;
    if (totalRows > rowLimit) {
      throw new ZipPackageError(
        `حداکثر ${rowLimit} ردیف در هر بسته مجاز است.`,
      );
    }

    tables.push(new InMemoryTableReader(tableNameFromPath(entryName), headers, rows));
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
