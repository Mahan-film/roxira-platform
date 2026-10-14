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
 * محدودیت‌ها همانند CSV است: حداکثر ۵ مگابایت و ۵۰۰۰ ردیف داده. هر محتوای
 * ZIP غیرمنتظره با پیام فارسی روشن رد می‌شود.
 */

import { inflateRawSync } from 'zlib';
import {
  MAX_IMPORT_ROWS,
  MAX_UPLOAD_BYTES,
} from '../constants/data-import.constants';

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

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_COMMENT_LENGTH = 0xffff;

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

/** نگاشت یک فایل داخل آرشیو ZIP. */
interface ZipEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** یافتن امضای «پایان فهرست مرکزی» (EOCD) از انتهای بافر. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 22 - MAX_COMMENT_LENGTH);
  for (let pos = buffer.length - 22; pos >= earliest; pos -= 1) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) {
      return pos;
    }
  }
  return -1;
}

/** خواندن فهرست مرکزی ZIP به‌صورت نگاشت «نام فایل ← نگاشت». */
function readCentralDirectory(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  let pos = offset;
  for (let index = 0; index < count; index += 1) {
    if (
      pos + 46 > buffer.length ||
      buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE
    ) {
      throw new XlsxParseError(INVALID_XLSX_MESSAGE);
    }
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer
      .toString('utf8', pos + 46, pos + 46 + nameLength)
      .replace(/^[./]+/, '');
    entries.set(name, { method, compressedSize, localOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** استخراج و ازفشرده‌سازی داده یک فایل داخل ZIP. */
function extractEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localOffset;
  if (localOffset + 30 > buffer.length) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) {
    return Buffer.from(data);
  }
  if (entry.method === 8) {
    try {
      return inflateRawSync(data);
    } catch {
      throw new XlsxParseError(INVALID_XLSX_MESSAGE);
    }
  }
  throw new XlsxParseError(
    'این فایل XLSX با روش فشرده‌سازی پشتیبانی‌نشده ذخیره شده است.',
  );
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

/* --------------------------------- API عمومی --------------------------------- */

/**
 * تجزیه فایل XLSX (بافر) به سربرگ و ردیف‌های داده.
 *
 * محدودیت حجم (۵ مگابایت) و تعداد ردیف داده (۵۰۰۰) همانند CSV اعمال می‌شود و
 * ردیف‌های کاملاً خالی حذف، سلول‌ها trim و طول ردیف‌ها با سربرگ هم‌تراز
 * می‌گردد.
 */
export function parseXlsx(input: Buffer): ParsedXlsx {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new XlsxParseError('حجم فایل اکسل بیش از ۵ مگابایت است.');
  }

  const entries = readCentralDirectory(buffer);
  const sheetName = findSheetName(buffer, entries);
  const sheetEntry = entries.get(sheetName);
  if (!sheetEntry) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }

  const sheet = parseXml(extractEntry(buffer, sheetEntry).toString('utf8'));
  const worksheet =
    sheet.tagName === 'worksheet' ? sheet : firstChild(sheet, 'worksheet');
  if (!worksheet) {
    throw new XlsxParseError(INVALID_XLSX_MESSAGE);
  }

  const sharedStrings = readSharedStrings(buffer, entries);

  const cleaned = readRows(worksheet, sharedStrings)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleaned.length === 0) {
    throw new XlsxParseError('فایل هیچ ردیف داده‌ای ندارد.');
  }

  const headers = cleaned[0];
  const dataRows = cleaned.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new XlsxParseError(
      `حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بارگذاری مجاز است.`,
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
