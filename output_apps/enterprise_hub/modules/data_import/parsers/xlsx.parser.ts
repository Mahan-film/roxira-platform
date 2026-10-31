/**
 * تجزیه‌کننده XLSX سبک و بدون وابستگی خارجی.
 *
 * در `package.json` این پکیج هیچ کتابخانه‌ای مثل `xlsx` یا `exceljs` وجود ندارد؛
 * بنابراین این پیاده‌سازی خودش:
 *   ۱) ساختار ZIP فایل را با `zlib.inflateRawSync` می‌خواند،
 *   ۲) `xl/sharedStrings.xml` را استخراج می‌کند،
 *   ۳) نخستین برگه (`xl/worksheets/sheet1.xml` یا نخستین برگه فهرست‌شده در
 *      `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`) را می‌خواند و
 *   ۴) سلول‌ها (رشته مشترک، رشته درجا، عدد و منطقی) را به ردیف‌هایی از رشته
 *      تبدیل می‌کند و به حرف ستون (A، B، …، AA) احترام می‌گذارد تا سلول‌های
 *      خالی جای خود را حفظ کنند.
 *
 * محدودیت‌ها همانند CSV است: سقف حجم صفحه‌گسترده (پیش‌فرض ۱۰ مگابایت) و سقف
 * ردیف (پیش‌فرض ۲۰٬۰۰۰). هر محتوای ZIP غیرمنتظره با پیام فارسی روشن رد می‌شود.
 */

import {
  maxImportRows,
  maxSheetBytes,
} from '../constants/data-import.constants';
import { HeaderLocator, safeHeaderIndex } from './csv.parser';
import {
  extractZipEntry,
  InflateBudget,
  listZipEntries,
  ZipReadError,
} from './zip-reader';

/** خروجی تجزیه: سربرگ‌ها و ردیف‌های داده (به‌ترتیب ستون‌ها). */
export interface ParsedXlsx {
  headers: string[];
  rows: string[][];
}

/** خطای تجزیه فایل XLSX. */
export class XlsxParseError extends Error {}

/** پیام یکسان برای هر فایل XLSX نامعتبر/آسیب‌دیده. */
const INVALID_XLSX_MESSAGE =
  'فایل اکسل معتبر نیست؛ این فایل XLSX نیست یا آسیب‌دیده است.';

/** سقف پیش‌فرض مجموع حجم بازشدهٔ یک فایل XLSX: ۱۰۰ مگابایت. */
const DEFAULT_MAX_INFLATED_BYTES = 100 * 1024 * 1024;

function maxInflatedBytes(): number {
  const value = Number.parseInt(process.env.IMPORT_MAX_INFLATED_BYTES ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_INFLATED_BYTES;
}

/* ----------------------------- تجزیه‌گر XML سبک ----------------------------- */

/** گره حداقلی XML برای پیمایش اسناد دفتر اکسل. */
interface XmlNode {
  tagName: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

/** رمزگشایی موجودیت‌های نام‌دار و عددی XML. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(/&amp;/g, '&');
}

const NAME_CHAR = /[\w:.\-]/;

/**
 * تجزیه‌گر بازگشتی و کوچک XML؛ فقط به اندازه نیاز دفتر اکسل (تگ، ویژگی،
 * متن، CDATA، کامنت و دستور XML). برای ورودی نامعتبر `XlsxParseError`
 * می‌اندازد.
 */
function parseXml(source: string): XmlNode {
  let pos = 0;
  const size = source.length;

  function fail(): never {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }

  function skipWhitespace(): void {
    while (pos < size && /\s/.test(source[pos])) {
      pos += 1;
    }
  }

  function readName(): string {
    const start = pos;
    while (pos < size && NAME_CHAR.test(source[pos])) {
      pos += 1;
    }
    if (pos === start) {
      fail();
    }
    return source.slice(start, pos);
  }

  function readAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWhitespace();
      if (pos >= size || source[pos] === '>' || source[pos] === '/') {
        return attrs;
      }
      const name = readName();
      skipWhitespace();
      if (source[pos] !== '=') {
        attrs[name] = '';
        continue;
      }
      pos += 1;
      skipWhitespace();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") {
        const start = pos;
        while (pos < size && !/[\s>]/.test(source[pos])) {
          pos += 1;
        }
        attrs[name] = decodeXmlEntities(source.slice(start, pos));
        continue;
      }
      pos += 1;
      const start = pos;
      while (pos < size && source[pos] !== quote) {
        pos += 1;
      }
      attrs[name] = decodeXmlEntities(source.slice(start, pos));
      pos += 1;
    }
  }

  function parseElement(): XmlNode {
    pos += 1; // '<'
    const node: XmlNode = {
      tagName: readName(),
      attrs: readAttributes(),
      children: [],
      text: '',
    };
    skipWhitespace();
    if (source[pos] === '/') {
      pos += 1;
      if (source[pos] !== '>') {
        fail();
      }
      pos += 1;
      return node;
    }
    if (source[pos] !== '>') {
      fail();
    }
    pos += 1;

    let text = '';
    for (;;) {
      if (pos >= size) {
        fail();
      }
      if (source[pos] !== '<') {
        text += source[pos];
        pos += 1;
        continue;
      }
      if (source.startsWith('<!--', pos)) {
        const end = source.indexOf('-->', pos + 4);
        if (end === -1) {
          fail();
        }
        pos = end + 3;
        continue;
      }
      if (source.startsWith('<![CDATA[', pos)) {
        const end = source.indexOf(']]>', pos + 9);
        if (end === -1) {
          fail();
        }
        text += source.slice(pos + 9, end);
        pos = end + 3;
        continue;
      }
      if (source.startsWith('<?', pos)) {
        const end = source.indexOf('?>', pos + 2);
        if (end === -1) {
          fail();
        }
        pos = end + 2;
        continue;
      }
      if (source[pos + 1] === '/') {
        pos += 2;
        const closing = readName();
        skipWhitespace();
        if (source[pos] !== '>') {
          fail();
        }
        pos += 1;
        if (closing !== node.tagName) {
          fail();
        }
        node.text = text;
        return node;
      }
      node.children.push(parseElement());
    }
  }

  skipWhitespace();
  while (pos < size) {
    if (source.startsWith('<?', pos)) {
      const end = source.indexOf('?>', pos + 2);
      if (end === -1) {
        fail();
      }
      pos = end + 2;
      continue;
    }
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4);
      if (end === -1) {
        fail();
      }
      pos = end + 3;
      continue;
    }
    if (source[pos] === '<') {
      return parseElement();
    }
    pos += 1;
  }
  return fail();
}

/** نخستین فرزند با نام داده‌شده. */
function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((child) => child.tagName === name);
}

/** تجمیع متن یک گره و همه نوادگانش (برای رشته‌های چندتکه/درجا). */
function collectText(node: XmlNode): string {
  let text = node.text;
  for (const child of node.children) {
    text += collectText(child);
  }
  return text;
}

/* -------------------------------- خواننده ZIP -------------------------------- */

type ZipEntry = import('./zip-reader').ZipEntry;

/** فهرست مرکزی به‌صورت نگاشت نام ← ورودی (ورودی تکراری، آخرین را نگه می‌دارد). */
function readCentralDirectory(buffer: Buffer): Map<string, ZipEntry> {
  try {
    return new Map(listZipEntries(buffer).map((entry) => [entry.name, entry]));
  } catch (error) {
    throw toXlsxError(error);
  }
}

/** تبدیل خطای ZIP به خطای فارسی XLSX. */
function toXlsxError(error: unknown): XlsxParseError {
  if (error instanceof ZipReadError) {
    if (error.code === 'too_large') {
      return new XlsxParseError(
        'محتوای بازشدهٔ فایل اکسل بیش از سقف مجاز است؛ فایل رد شد.',
      );
    }
    if (error.code === 'unsupported') {
      return new XlsxParseError(
        'این فایل XLSX با روش فشرده‌سازی پشتیبانی‌نشده ذخیره شده است.',
      );
    }
  }
  return new XlsxParseError(INVALID_XLSX_MESSAGE);
}

/** بودجهٔ بازشدن در حال پردازش (به‌ازای هر فراخوان `parseXlsx`). */
let activeBudget: InflateBudget = { remaining: 0 };

/** استخراج و ازفشرده‌سازی داده یک فایل داخل ZIP با سقف حجم واقعی. */
function extractEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  try {
    return extractZipEntry(buffer, entry, activeBudget);
  } catch (error) {
    throw toXlsxError(error);
  }
}

/* ----------------------------- استخراج اجزای XLSX ---------------------------- */

/** خواندن و تجزیه `xl/sharedStrings.xml` (در صورت وجود). */
function readSharedStrings(
  buffer: Buffer,
  entries: Map<string, ZipEntry>,
): string[] | null {
  const entry = entries.get('xl/sharedStrings.xml');
  if (!entry) {
    return null;
  }
  const root = parseXml(extractEntry(buffer, entry).toString('utf8'));
  const sst = root.tagName === 'sst' ? root : firstChild(root, 'sst');
  if (!sst) {
    return null;
  }
  const strings: string[] = [];
  for (const child of sst.children) {
    if (child.tagName === 'si') {
      strings.push(collectText(child));
    }
  }
  return strings;
}

/** ترکیب مسیر نسبی برگه با پوشه پایه (`xl`). */
function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) {
    return target.replace(/^\//, '');
  }
  const segments = [...base.split('/'), ...target.split('/')];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

/** نخستین برگه: `sheet1.xml` یا نخستین برگه فهرست‌شده در workbook + rels. */
function findSheetName(
  buffer: Buffer,
  entries: Map<string, ZipEntry>,
): string {
  if (entries.has('xl/worksheets/sheet1.xml')) {
    return 'xl/worksheets/sheet1.xml';
  }

  const workbookEntry = entries.get('xl/workbook.xml');
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
  if (workbookEntry && relsEntry) {
    const workbook = parseXml(extractEntry(buffer, workbookEntry).toString('utf8'));
    const workbookRoot =
      workbook.tagName === 'workbook' ? workbook : firstChild(workbook, 'workbook');
    const firstSheet = firstChild(workbookRoot, 'sheets')?.children.find(
      (child) => child.tagName === 'sheet',
    );
    const relationId = firstSheet?.attrs['r:id'];

    if (relationId) {
      const rels = parseXml(extractEntry(buffer, relsEntry).toString('utf8'));
      const relsRoot =
        rels.tagName === 'Relationships'
          ? rels
          : firstChild(rels, 'Relationships');
      const relation = relsRoot?.children.find(
        (child) =>
          child.tagName === 'Relationship' && child.attrs.Id === relationId,
      );
      const target = relation?.attrs.Target;
      if (target) {
        const path = resolveTarget('xl', target);
        if (entries.has(path)) {
          return path;
        }
      }
    }
  }

  throw new XlsxParseError(INVALID_XLSX_MESSAGE);
}

/* -------------------------------- تبدیل سلول‌ها ------------------------------ */

/** تبدیل حرف ستون (A، B، …، AA) به شماره ستون صفرپایه. */
function columnIndex(reference: string, fallback: number): number {
  const letters = /^([A-Za-z]+)/.exec(reference)?.[1];
  if (!letters) {
    return fallback;
  }
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** متن نخستین فرزند `<v>` سلول (یا رشته خالی). */
function valueText(cell: XmlNode): string {
  const value = firstChild(cell, 'v');
  return value ? collectText(value) : '';
}

/** تبدیل یک سلول `<c>` به رشته بر پایه نوع آن. */
function cellValue(cell: XmlNode, sharedStrings: string[] | null): string {
  const type = cell.attrs.t ?? 'n';
  if (type === 's') {
    const index = Number(valueText(cell).trim());
    return sharedStrings?.[index] ?? '';
  }
  if (type === 'inlineStr') {
    const inline = firstChild(cell, 'is');
    return inline ? collectText(inline) : '';
  }
  if (type === 'b') {
    const raw = valueText(cell).trim().toLowerCase();
    return raw === '1' || raw === 'true' ? 'true' : 'false';
  }
  return valueText(cell);
}

/** خواندن ردیف‌ها از `sheetData` با حفظ جایگاه ستون‌ها. */
function readRows(sheet: XmlNode, sharedStrings: string[] | null): string[][] {
  const sheetData = firstChild(sheet, 'sheetData');
  if (!sheetData) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }

  const rows: string[][] = [];
  for (const row of sheetData.children) {
    if (row.tagName !== 'row') {
      continue;
    }
    const values: string[] = [];
    for (const cell of row.children) {
      if (cell.tagName !== 'c') {
        continue;
      }
      const column = columnIndex(cell.attrs.r ?? '', values.length);
      const value = cellValue(cell, sharedStrings).trim();
      while (values.length <= column) {
        values.push('');
      }
      values[column] = value;
    }
    rows.push(values);
  }
  return rows;
}

/** One sheet to header + rows; null when it holds no data. */
function readSheetTable(
  buffer: Buffer,
  entry: ZipEntry,
  sharedStrings: string[] | null,
  locateHeader?: HeaderLocator,
): ParsedXlsx | null {
  const sheet = parseXml(extractEntry(buffer, entry).toString('utf8'));
  const worksheet =
    sheet.tagName === 'worksheet' ? sheet : firstChild(sheet, 'worksheet');
  if (!worksheet) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }

  const cleaned = readRows(worksheet, sharedStrings)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleaned.length === 0) {
    return null;
  }

  const headerIndex = safeHeaderIndex(cleaned, locateHeader);
  const headers = cleaned[headerIndex];
  const dataRows = cleaned.slice(headerIndex + 1);
  const rowLimit = maxImportRows();
  if (dataRows.length > rowLimit) {
    throw new XlsxParseError(
      `حداکثر ${rowLimit} ردیف در هر بارگذاری مجاز است.`,
    );
  }

  const rows = dataRows.map((row) => {
    const normalized = row.slice(0, headers.length);
    while (normalized.length < headers.length) {
      normalized.push('');
    }
    return normalized;
  });

  return { headers, rows };
}

/* --------------------------------- API عمومی --------------------------------- */

/**
 * تجزیه فایل XLSX (بافر) به سربرگ و ردیف‌های داده.
 *
 * محدودیت حجم (پیش‌فرض ۱۰ مگابایت) و تعداد ردیف داده (پیش‌فرض ۲۰٬۰۰۰) همانند
 * CSV اعمال می‌شود و ردیف‌های کاملاً خالی حذف، سلول‌ها trim و طول ردیف‌ها با
 * سربرگ هم‌تراز می‌گردد. تنها نخستین برگه خوانده می‌شود.
 */
export function parseXlsx(
  input: Buffer,
  locateHeader?: HeaderLocator,
  budget?: InflateBudget,
): ParsedXlsx {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const sizeLimit = maxSheetBytes();
  if (buffer.length > sizeLimit) {
    throw new XlsxParseError(
      `حجم فایل اکسل بیش از ${Math.round(sizeLimit / 1024 / 1024)} مگابایت است.`,
    );
  }

  // Shared budget lets a ZIP of XLSX files cap the TOTAL inflated size, not just each file's.
  activeBudget = budget ?? { remaining: maxInflatedBytes() };
  const entries = readCentralDirectory(buffer);
  const sheetName = findSheetName(buffer, entries);
  const sheetEntry = entries.get(sheetName);
  if (!sheetEntry) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }
  const table = readSheetTable(buffer, sheetEntry, readSharedStrings(buffer, entries), locateHeader);
  if (!table) {
    throw new XlsxParseError('فایل هیچ ردیف داده‌ای ندارد.');
  }
  return table;
}

/** Visible sheets in workbook order, as (name, zip path). Without a usable workbook.xml: every worksheet part. */
function listSheets(buffer: Buffer, entries: Map<string, ZipEntry>): { sheets: Array<{ name: string; path: string }>; hidden: number } {
  const workbookEntry = entries.get('xl/workbook.xml');
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
  const sheets: Array<{ name: string; path: string }> = [];
  let hidden = 0;
  if (workbookEntry && relsEntry) {
    const workbook = parseXml(extractEntry(buffer, workbookEntry).toString('utf8'));
    const root = workbook.tagName === 'workbook' ? workbook : firstChild(workbook, 'workbook');
    const rels = parseXml(extractEntry(buffer, relsEntry).toString('utf8'));
    const relsRoot = rels.tagName === 'Relationships' ? rels : firstChild(rels, 'Relationships');
    for (const sheet of firstChild(root, 'sheets')?.children ?? []) {
      if (sheet.tagName !== 'sheet') {
        continue;
      }
      if (sheet.attrs.state && sheet.attrs.state !== 'visible') {
        hidden += 1;
        continue;
      }
      const target = relsRoot?.children.find(
        (child) => child.tagName === 'Relationship' && child.attrs.Id === sheet.attrs['r:id'],
      )?.attrs.Target;
      if (target) {
        const entryPath = resolveTarget('xl', target);
        if (entries.has(entryPath)) {
          sheets.push({ name: sheet.attrs.name || `Sheet${sheets.length + 1}`, path: entryPath });
        }
      }
    }
  }
  if (sheets.length === 0 && hidden === 0) {
    [...entries.keys()]
      .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
      .sort((x, y) => x.localeCompare(y, 'en', { numeric: true }))
      .forEach((entryPath, index) => sheets.push({ name: `Sheet${index + 1}`, path: entryPath }));
  }
  return { sheets, hidden };
}

export interface ParsedSheet extends ParsedXlsx {
  name: string;
}

/** Every visible sheet with data. The size and inflate budgets are shared; the row cap applies to the whole file. */
export function parseXlsxSheets(
  input: Buffer,
  locateHeader?: HeaderLocator,
  budget?: InflateBudget,
): { sheets: ParsedSheet[]; hiddenSheets: number } {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const sizeLimit = maxSheetBytes();
  if (buffer.length > sizeLimit) {
    throw new XlsxParseError(
      `حجم فایل اکسل بیش از ${Math.round(sizeLimit / 1024 / 1024)} مگابایت است.`,
    );
  }
  activeBudget = budget ?? { remaining: maxInflatedBytes() };
  const entries = readCentralDirectory(buffer);
  const { sheets: listed, hidden } = listSheets(buffer, entries);
  const sharedStrings = readSharedStrings(buffer, entries);
  const sheets: ParsedSheet[] = [];
  let total = 0;
  for (const { name, path } of listed) {
    const table = readSheetTable(buffer, entries.get(path) as ZipEntry, sharedStrings, locateHeader);
    if (!table) {
      continue;
    }
    total += table.rows.length;
    if (total > maxImportRows()) {
      throw new XlsxParseError(`حداکثر ${maxImportRows()} ردیف در هر بارگذاری مجاز است.`);
    }
    sheets.push({ name, ...table });
  }
  if (sheets.length === 0) {
    throw new XlsxParseError('فایل هیچ ردیف داده‌ای ندارد.');
  }
  return { sheets, hiddenSheets: hidden };
}
