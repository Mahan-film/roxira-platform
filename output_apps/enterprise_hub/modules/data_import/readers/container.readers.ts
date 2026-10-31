/** خوانندگان قالب‌های موجود (SQLite، SQL با دیالکت SQLite، XLSX) و محتوا‌محور‌شدن آن‌ها + ZIP/چندفایلی. */

import {
  PACKAGE_MAX_UNCOMPRESSED_BYTES,
  PACKAGE_MAX_ZIP_FILES,
} from '../constants/package-import.constants';
import { parseXlsx } from '../parsers/xlsx.parser';
import { openSqlDump } from '../parsers/sql-dump.parser';
import { isSqliteHeader, openSqlite } from '../parsers/sqlite.parser';
import {
  extractZipEntry,
  InflateBudget,
  listZipEntries,
  ZipEntry,
  ZipReadError,
} from '../parsers/zip-reader';
import { assertZipWithinLimits } from '../parsers/zip.parser';
import { InMemoryTableReader, PackageRelationship, PackageTableReader, ParsedPackage } from '../parsers/package-source.types';
import { READER_LIMITS } from './limits';
import { decodeText } from './persian/text-decode';
import { zipMimetype } from './ods.reader';
import { detectDumpDialect } from './sql-dump.reader';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, pickHeaderRow, sanitiseTableName, TableNotes, uniqueTableName } from './tabular';
import { headText, packageOf } from './text-formats.reader';

export const sqliteReader: FormatReader = {
  id: 'sqlite',
  labelFa: 'دیتابیس SQLite',
  extensions: ['.sqlite', '.sqlite3', '.db'],
  detect: (buffer) => (isSqliteHeader(buffer) ? 1 : 0),
  async read(buffer) {
    const pkg = await openSqlite(buffer);
    pkg.formatId = 'sqlite';
    return pkg;
  },
};

/** SQL با دیالکت SQLite/عمومی: فقط وقتی دیالکت دیگری تشخیص داده نشود. اجرای آن همان ورکر حصاردار PR 906 است. */
export const sqliteSqlReader: FormatReader = {
  id: 'sql',
  labelFa: 'دامپ SQL (دیالکت SQLite)',
  extensions: ['.sql'],
  detect(buffer, fileName) {
    if (buffer.length === 0 || buffer.subarray(0, 4096).includes(0)) return 0;
    const head = headText(buffer, 200_000);
    if (!/\b(INSERT\s+INTO|CREATE\s+TABLE)\b/i.test(head)) return 0;
    if (detectDumpDialect(head) !== null) return 0;
    return /\.sql$/i.test(fileName) ? 0.7 : 0.5;
  },
  async read(buffer) {
    const decoded = decodeText(buffer);
    const pkg = await openSqlDump(decoded.text);
    pkg.formatId = 'sql';
    pkg.notes = [...(pkg.notes ?? []), ...decoded.notes];
    return pkg;
  },
};

function zipNames(buffer: Buffer): string[] | null {
  if (buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
  try {
    return listZipEntries(buffer).map((e) => e.name);
  } catch {
    return null;
  }
}

/** XLSX: کارپوشه یا دست‌کم یک برگهٔ استاندارد (برخی تولیدکننده‌ها workbook.xml را حذف می‌کنند). */
export function isXlsxNames(names: string[]): boolean {
  return names.includes('xl/workbook.xml') || names.some((n) => n.startsWith('xl/worksheets/'));
}

export const xlsxReader: FormatReader = {
  id: 'xlsx',
  labelFa: 'اکسل (XLSX)',
  extensions: ['.xlsx', '.xlsm'],
  detect(buffer) {
    const names = zipNames(buffer);
    return names && isXlsxNames(names) ? 0.95 : 0;
  },
  read(buffer) {
    const parsed = parseXlsx(buffer, pickHeaderRow);
    const notes = new TableNotes();
    const table = buildTable('Sheet1', [parsed.headers, ...parsed.rows], notes);
    return packageOf('xlsx', [table], notes, [
      'فقط برگهٔ اولِ فایل XLSX خوانده می‌شود؛ برگه‌های دیگر را جداگانه یا در ZIP بفرستید.',
    ]);
  },
};

/** خواندن یک فایل داخلی (ZIP یا پوشه): تابعی که ثبت‌کنندهٔ قالب‌ها تزریق می‌کند. */
export type InnerReader = (buffer: Buffer, fileName: string, depth: number) => Promise<ParsedPackage>;

function unsafeName(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  return n.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(n) || /^[A-Za-z]:/.test(n) || n.includes('\0');
}

function baseName(name: string): string {
  const n = name.replace(/\\/g, '/');
  return n.slice(n.lastIndexOf('/') + 1);
}

function stem(name: string): string {
  const base = baseName(name);
  return base.replace(/\.[^.]+$/, '') || base;
}

/** ادغام چند فایل در یک بسته؛ خطای یک فایل کل بسته را خراب نمی‌کند ولی در یادداشت‌ها می‌آید. */
export async function mergeFiles(
  count: number,
  load: (index: number) => { name: string; buffer: Buffer } | null,
  readInner: InnerReader,
  depth: number,
  formatId: 'zip' | 'multi',
): Promise<ParsedPackage> {
  const tables: PackageTableReader[] = [];
  const relationships: PackageRelationship[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const file = load(i);
    if (!file) continue;
    const { name, buffer } = file;
    if (unsafeName(name)) {
      failures.push(`«${baseName(name)}»: مسیر ناامن نادیده گرفته شد.`);
      continue;
    }
    if (/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i.test(name.replace(/\\/g, '/'))) continue;
    try {
      const inner = await readInner(buffer, name, depth + 1);
      for (const note of inner.notes ?? []) notes.push(`«${baseName(name)}»: ${note}`);
      const multi = inner.tables.length > 1;
      for (const table of inner.tables) {
        const wanted = multi ? `${stem(name)}__${table.name}` : stem(name);
        const unique = uniqueTableName(sanitiseTableName(wanted), used);
        tables.push(unique === table.name ? table : renameTable(table, unique));
      }
      relationships.push(...inner.relationships);
    } catch (error) {
      failures.push(`«${baseName(name)}»: ${error instanceof Error ? error.message : 'خوانده نشد.'}`);
    }
    if (tables.length > READER_LIMITS.maxTables) throw new ReaderError('تعداد جدول‌ها بیش از سقف مجاز است.');
  }
  if (tables.length === 0) {
    throw new ReaderError(
      `هیچ فایل قابل خواندنی پیدا نشد.${failures.length ? ` ${failures.slice(0, 3).join(' ؛ ')}` : ''}`,
    );
  }
  if (failures.length > 0) notes.push(...failures.slice(0, 20).map((f) => `نادیده گرفته شد — ${f}`));
  return { tables, relationships, formatId, notes, close: () => undefined };
}

function renameTable(table: PackageTableReader, name: string): PackageTableReader {
  return {
    name,
    columns: table.columns,
    rowCount: table.rowCount,
    hint: table.hint,
    readPage: (offset, limit) => table.readPage(offset, limit),
  };
}

export function createZipReader(readInner: InnerReader): FormatReader {
  return {
    id: 'zip',
    labelFa: 'آرشیو ZIP (چند فایل)',
    extensions: ['.zip'],
    detect(buffer) {
      const names = zipNames(buffer);
      if (!names) return 0;
      if (isXlsxNames(names)) return 0;
      if (names.includes('content.xml') && /spreadsheet/.test(zipMimetype(buffer) ?? '')) return 0;
      return 0.6;
    },
    async read(buffer, ctx) {
      if (ctx.depth >= READER_LIMITS.maxZipDepth) {
        throw new ReaderError('ZIP تودرتو پذیرفته نمی‌شود.');
      }
      const count = assertZipWithinLimits(buffer);
      if (count > PACKAGE_MAX_ZIP_FILES) throw new ReaderError(`تعداد فایل‌های داخل ZIP بیش از ${PACKAGE_MAX_ZIP_FILES} است.`);
      let entries: ZipEntry[];
      try {
        entries = listZipEntries(buffer).filter((e) => !e.name.endsWith('/'));
      } catch {
        throw new ReaderError('فایل ZIP معتبر نیست یا آسیب‌دیده است.');
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const budget: InflateBudget = { remaining: PACKAGE_MAX_UNCOMPRESSED_BYTES };
      return mergeFiles(
        entries.length,
        (i) => {
          const entry = entries[i];
          if (unsafeName(entry.name)) return { name: entry.name, buffer: Buffer.alloc(0) };
          try {
            return { name: entry.name, buffer: extractZipEntry(buffer, entry, budget) };
          } catch (error) {
            if (error instanceof ZipReadError && error.code === 'too_large') {
              throw new ReaderError('حجم بازِ فایل ZIP بیش از سقف مجاز (۲۰۰ مگابایت) است.');
            }
            return null;
          }
        },
        readInner,
        ctx.depth,
        'zip',
      );
    },
  };
}

export { InMemoryTableReader };
