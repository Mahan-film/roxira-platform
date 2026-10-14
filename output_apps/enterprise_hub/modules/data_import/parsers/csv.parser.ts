/**
 * تجزیه‌کننده CSV سبک و بدون وابستگی خارجی.
 *
 * در `package.json` این پکیج هیچ کتابخانه‌ای مثل `xlsx` یا `papaparse` وجود
 * ندارد؛ بنابراین نسخه MVP فقط فایل CSV را می‌پذیرد (فایل XLSX با پیام روشن
 * رد می‌شود). این پیاده‌سازی از نقل‌قول‌های دوگانه، جداکننده‌های داخل
 * نقل‌قول، خط‌پایان CRLF و BOM پشتیبانی می‌کند.
 */

/** خروجی تجزیه: سربرگ‌ها و ردیف‌های داده (به‌ترتیب ستون‌ها). */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** خطای تجزیه فایل CSV. */
export class CsvParseError extends Error {}

/**
 * تشخیص جداکننده ستون‌ها بر پایه شمارش در خط سربرگ.
 * جداکننده‌های پشتیبانی‌شده: `,`، `;`، تب و `|`.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/**
 * تجزیه متن CSV به سربرگ و ردیف‌ها.
 *
 * سلول‌ها trim می‌شوند، ردیف‌های کاملاً خالی حذف و طول هر ردیف با تعداد
 * سربرگ‌ها هم‌تراز می‌شود.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  if (!text.trim()) {
    throw new CsvParseError('فایل خالی است.');
  }

  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
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
  }

  const cleaned = records
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleaned.length === 0) {
    throw new CsvParseError('فایل هیچ ردیف داده‌ای ندارد.');
  }

  const headerRow = cleaned[0];
  const dataRows = cleaned.slice(1);
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
