/**
 * انواع مشترک منابع بستهٔ دیتابیس (SQLite / دامپ SQL / ZIP).
 *
 * همه منابع (فایل SQLite واقعی، دامپ SQL اجراشده در حافظه، و ZIP از فایل‌های
 * CSV/XLSX) خود را به‌صورت مجموعه‌ای از «خوانندهٔ جدول صفحه‌ای» ارائه می‌دهند تا
 * لایه تحلیل فقط یک قرارداد واحد بشناسد و حافظه کران‌دار بماند.
 */

/** یک ستون جدول با نام و نوع اعلام‌شده. */
export interface PackageColumn {
  name: string;
  type: string;
}

/** خوانندهٔ صفحه‌ای یک جدول؛ هرگز بیش از یک صفحه از یک جدول را در حافظه نمی‌خواهد. */
export interface PackageTableReader {
  name: string;
  columns: PackageColumn[];
  rowCount: number;
  readPage(offset: number, limit: number): Record<string, unknown>[];
}

/** رابطه اعلام‌شده (کلید خارجی) یا استنباط‌شده بین دو جدول. */
export interface PackageRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  declared: boolean;
}

/** بستهٔ تجزیه‌شده: جداول + روابط اعلام‌شده. */
export interface ParsedPackage {
  tables: PackageTableReader[];
  relationships: PackageRelationship[];
  close(): void;
}

/** تبدیل یک مقدار سلول به رشته (خالی برای null/undefined). */
export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

/** استنباط سادهٔ نوع ستون از نمونه مقادیر (برای CSV/XLSX). */
export function inferColumnType(values: unknown[]): string {
  let sawText = false;
  let sawNumber = false;
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value).trim())) {
      sawNumber = true;
    } else {
      sawText = true;
    }
  }
  if (sawText) {
    return 'TEXT';
  }
  if (sawNumber) {
    return 'REAL';
  }
  return 'TEXT';
}

/** خوانندهٔ جدول درون‌حافظه‌ای برای CSV/XLSX. */
export class InMemoryTableReader implements PackageTableReader {
  readonly columns: PackageColumn[];
  readonly rowCount: number;

  constructor(
    readonly name: string,
    headers: string[],
    private readonly rows: string[][],
  ) {
    const sample = rows.slice(0, 50);
    this.columns = headers.map((header, index) => ({
      name: header,
      type: inferColumnType(sample.map((row) => row[index])),
    }));
    this.rowCount = rows.length;
  }

  readPage(offset: number, limit: number): Record<string, unknown>[] {
    const slice = this.rows.slice(offset, offset + limit);
    return slice.map((row) => {
      const record: Record<string, unknown> = {};
      this.columns.forEach((column, index) => {
        record[column.name] = row[index] ?? '';
      });
      return record;
    });
  }
}
