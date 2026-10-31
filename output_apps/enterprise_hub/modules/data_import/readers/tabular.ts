import {
  InMemoryTableReader,
  TableHint,
} from '../parsers/package-source.types';
import { fixPersianChars } from '../normaliser/normalise';
import { READER_LIMITS, rowLimit } from './limits';
import { ReaderError } from './reader.types';

/** شمارندهٔ یادداشت‌های ساخت جدول (اصلاح حروف عربی، بریدن سلول بلند …). */
export class TableNotes {
  arabicLetterCells = 0;
  truncatedCells = 0;
  droppedColumns = 0;
  totalCells = 0;
  readonly extra: string[] = [];

  toList(): string[] {
    const notes = [...this.extra];
    if (this.arabicLetterCells > 0) {
      notes.push(
        `${this.arabicLetterCells} سلول حروف عربی (ي/ك) داشت و به حروف فارسی (ی/ک) یکسان‌سازی شد.`,
      );
    }
    if (this.truncatedCells > 0) {
      notes.push(
        `${this.truncatedCells} سلول بیش از ${READER_LIMITS.maxCellChars} نویسه بود و بریده شد.`,
      );
    }
    if (this.droppedColumns > 0) {
      notes.push(
        `${this.droppedColumns} ستون اضافه (بیش از ${READER_LIMITS.maxColumns}) نادیده گرفته شد.`,
      );
    }
    return notes;
  }
}

const ARABIC_ONLY = /[يكةى]/;

/** پاک‌سازی یک سلول: کنترل‌کاراکتر، بریدن، یکسان‌سازی ي/ك. */
export function cleanCell(value: unknown, notes: TableNotes): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);
  if (text.length > READER_LIMITS.maxCellChars) {
    text = text.slice(0, READER_LIMITS.maxCellChars);
    notes.truncatedCells += 1;
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (ARABIC_ONLY.test(text)) {
    text = fixPersianChars(text);
    notes.arabicLetterCells += 1;
  }
  return text.trim();
}

/** یکتا و پاک کردن سربرگ‌ها: خالی → «ستون_n»، تکراری → «_2». */
export function cleanHeaders(headers: unknown[], notes: TableNotes): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  headers.slice(0, READER_LIMITS.maxColumns).forEach((raw, index) => {
    let name = cleanCell(raw, notes).replace(/\s+/g, ' ');
    if (!name) {
      name = `ستون_${index + 1}`;
    }
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
      candidate = `${name}_${n}`;
    }
    used.add(candidate.toLowerCase());
    result.push(candidate);
  });
  notes.droppedColumns += Math.max(0, headers.length - READER_LIMITS.maxColumns);
  return result;
}

/** انتخاب سطر سربرگ: نخستین سطری که دست‌کم نیمی از عریض‌ترین سطرهای ابتدایی را پر کرده است. */
export function pickHeaderRow(rows: string[][]): number {
  const filled = rows.slice(0, 12).map((row) => row.filter((c) => c !== '').length);
  const widest = Math.max(0, ...filled);
  if (widest < 2) {
    return Math.max(0, filled.findIndex((n) => n > 0));
  }
  const need = Math.max(2, Math.ceil(widest * 0.6));
  const index = filled.findIndex((n) => n >= need);
  return index === -1 ? 0 : index;
}

export interface BuildTableOptions {
  hint?: TableHint;
  /** اگر true، سطر سربرگ خودکار انتخاب می‌شود (اکسل/ODS با عنوان بالای جدول). */
  autoHeader?: boolean;
}

/**
 * ساخت جدول از ماتریس خام سلول‌ها؛ محل مشترک اعمال سقف‌ها و پاک‌سازی.
 * `used` شمارندهٔ کل سلول‌های بسته است تا چند جدول هم سقف مشترک بگیرند.
 */
export function buildTable(
  name: string,
  matrix: unknown[][],
  notes: TableNotes,
  options: BuildTableOptions = {},
): InMemoryTableReader | null {
  const cleaned: string[][] = [];
  for (const row of matrix) {
    const cells = row
      .slice(0, READER_LIMITS.maxColumns)
      .map((cell) => cleanCell(cell, notes));
    if (cells.some((cell) => cell !== '')) {
      cleaned.push(cells);
    }
  }
  if (cleaned.length === 0) {
    return null;
  }
  const headerIndex = options.autoHeader ? pickHeaderRow(cleaned) : 0;
  const headers = cleanHeaders(cleaned[headerIndex], notes);
  const body = cleaned.slice(headerIndex + 1);
  if (body.length > rowLimit()) {
    throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
  }
  notes.totalCells += body.length * headers.length;
  if (notes.totalCells > READER_LIMITS.maxCells) {
    throw new ReaderError('تعداد کل سلول‌های فایل بیش از سقف مجاز است.');
  }
  const rows = body.map((row) => {
    const out = row.slice(0, headers.length);
    while (out.length < headers.length) {
      out.push('');
    }
    return out;
  });
  return new InMemoryTableReader(sanitiseTableName(name), headers, rows, options.hint);
}

/** نام جدول پاک‌سازی‌شده (بدون نویسهٔ خطرناک، کوتاه، ضد prototype). */
export function sanitiseTableName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_ .-]/gu, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 64);
  if (!cleaned || /^(__proto__|constructor|prototype)$/i.test(cleaned)) {
    return 'table';
  }
  return cleaned;
}

export function uniqueTableName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = `${name.slice(0, 60)}_${n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
