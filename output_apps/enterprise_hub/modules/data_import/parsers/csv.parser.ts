/**
 * تجزیه‌کننده CSV سبک و بدون وابستگی خارجی.
 *
 * در `package.json` این پکیج هیچ کتابخانه‌ای مثل `xlsx` یا `papaparse` وجود
 * ندارد؛ بنابراین نسخه MVP فقط فایل CSV را می‌پذیرد (فایل XLSX با پیام روشن
 * رد می‌شود). این پیاده‌سازی از نقل‌قول‌های دوگانه، جداکننده‌های داخل
 * نقل‌قول، خط‌پایان CRLF و BOM پشتیبانی می‌کند. شمار ردیف‌ها در حین پیمایش
 * یک‌بارمصرف محدود می‌شود تا حافظه کران‌دار بماند.
 */

import { maxImportRows } from '../constants/data-import.constants';

/** خروجی تجزیه: سربرگ‌ها و ردیف‌های داده (به‌ترتیب ستون‌ها). */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Picks the header row among the first rows of a sheet (title rows above the table, e.g. bank
 * statements). Returns an index into the non-empty rows; 0 keeps the old behaviour.
 */
export type HeaderLocator = (rows: string[][]) => number;

/** Clamps a locator result to a valid row index (anything odd falls back to the first row). */
export function safeHeaderIndex(
  rows: string[][],
  locateHeader?: HeaderLocator,
): number {
  if (!locateHeader) {
    return 0;
  }
  const index = locateHeader(rows);
  return Number.isInteger(index) && index > 0 && index < rows.length ? index : 0;
}

/** خطای تجزیه فایل CSV. */
export class CsvParseError extends Error {}

/**
 * تشخیص جداکننده ستون‌ها بر پایه شمارش در خط سربرگ.
 * جداکننده‌های پشتیبانی‌شده: `,`، `;`، تب و `|`.
 */
export function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t', '|'];
  const pick = (line: string): { delimiter: string; count: number } => {
    let best = ',';
    let bestCount = -1;
    for (const candidate of candidates) {
      const count = line.split(candidate).length - 1;
      if (count > bestCount) {
        bestCount = count;
        best = candidate;
      }
    }
    return { delimiter: best, count: bestCount };
  };
  const lines = text.split(/\r?\n/, 20);
  const first = pick(lines[0] ?? '');
  if (first.count > 0) {
    return first.delimiter;
  }
  // A title line above the table (bank statements): use the line with the most separators.
  let fallback = first;
  for (const line of lines.slice(1)) {
    const candidate = pick(line);
    if (candidate.count > fallback.count) {
      fallback = candidate;
    }
  }
  return fallback.delimiter;
}

/**
 * تجزیه متن CSV به سربرگ و ردیف‌ها.
 *
 * سلول‌ها trim می‌شوند، ردیف‌های کاملاً خالی حذف و طول هر ردیف با تعداد
 * سربرگ‌ها هم‌تراز می‌شود. به‌محض عبور از سقف ردیف (`maxRows`، پیش‌فرض
 * `IMPORT_MAX_ROWS`) تجزیه با خطای فارسی متوقف می‌شود تا حافظه کران‌دار بماند.
 */
export function parseCsv(
  input: string,
  maxRows: number = maxImportRows(),
  locateHeader?: HeaderLocator,
): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  if (!text.trim()) {
    throw new CsvParseError('فایل خالی است.');
  }

  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  /**
   * سربرگ + سقف ردیف + یک ردیف رواداری (خط خالی انتهایی). این سقف فقط برای
   * کران‌دار نگه‌داشتن حافظه است؛ حد دقیق در سرویس اعمال می‌شود.
   */
  const maxRecords = maxRows + 2;
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      record.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      record.push(field);
      records.push(record);
      if (records.length > maxRecords) {
        throw new CsvParseError(
          `حداکثر ${maxRows} ردیف در هر بارگذاری مجاز است.`,
        );
      }
      field = '';
      record = [];
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
    if (records.length > maxRecords) {
      throw new CsvParseError(
        `حداکثر ${maxRows} ردیف در هر بارگذاری مجاز است.`,
      );
    }
  }

  const cleaned = records
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleaned.length === 0) {
    throw new CsvParseError('فایل هیچ ردیف داده‌ای ندارد.');
  }

  const headerIndex = safeHeaderIndex(cleaned, locateHeader);
  const headerRow = cleaned[headerIndex];
  const dataRows = cleaned.slice(headerIndex + 1);
  const headers = headerRow.map((header) => header);

  const rows = dataRows.map((row) => {
    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) {
      normalized.push('');
    }
    return normalized;
  });

  return { headers, rows };
}
