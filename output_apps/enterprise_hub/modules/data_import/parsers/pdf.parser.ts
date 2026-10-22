/**
 * تجزیه‌کننده PDF متنی سبک و بدون وابستگی خارجی.
 *
 * در `package.json` این پکیج هیچ کتابخانه‌ای مثل `pdf-parse`/`pdfjs-dist` وجود
 * ندارد و افزودن وابستگی جدید نیازمند به‌روزرسانی `package-lock.json` است که
 * در این تغییر مجاز نیست؛ بنابراین این پیاده‌سازی خودش (هم‌سبک با
 * `csv.parser.ts` و `xlsx.parser.ts`):
 *   ۱) اشیای PDF (`N G obj … endobj`) و استریم‌های `FlateDecode` را می‌خواند،
 *   ۲) درخت صفحه‌ها را از `/Root` → `/Pages` → `/Kids` به ترتیب می‌پیماید،
 *   ۳) عملگرهای متنی (`BT/ET`, `Tf`, `Td/TD/Tm/T*`, `Tj/TJ`, `'`/`"`) را
 *      اجرا و متن را با مختصات `x,y` جمع می‌کند،
 *   ۴) متن را بر پایه `y` به خط و بر پایه فاصله افقی به سلول‌ها می‌شکند و
 *      سربرگ + ردیف‌های جدول می‌سازد.
 *
 * برای PDFهای فارسی، جدول `ToUnicode` فونت‌های `Type0` (Identity-H) خوانده
 * می‌شود؛ در نبود آن، بایت‌ها به‌صورت Latin-1 تفسیر می‌شوند.
 *
 * محدودیت‌ها: PDFهای دارای `ObjStm`/`XRef stream` (PDF 1.5+) و متنِ تصویری
 * پشتیبانی نمی‌شوند؛ PDF اسکن‌شده با `ScannedPdfError` و پیام فارسی روشن رد
 * می‌شود (رندر صفحه بدون کتابخانه JS خالص ممکن نیست).
 */

import { inflateSync } from 'zlib';
import {
  MAX_IMPORT_ROWS,
  MAX_UPLOAD_BYTES,
} from '../constants/data-import.constants';

/** خروجی مشترک همه تجزیه‌کننده‌ها: سربرگ‌ها و ردیف‌های داده. */
export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** خطای تجزیه فایل PDF. */
export class PdfParseError extends Error {}

/** خطای ویژه PDF اسکن‌شده (بدون متن قابل استخراج). */
export class ScannedPdfError extends PdfParseError {}

/** پیام یکسان برای PDF نامعتبر/آسیب‌دیده. */
const INVALID_PDF_MESSAGE = 'فایل PDF معتبر نیست یا آسیب‌دیده است.';

/** پیام روشن برای PDF اسکن‌شده (بدون رندرکننده JS خالص). */
const SCANNED_PDF_MESSAGE =
  'این PDF متن قابل استخراج ندارد (اسکن‌شده است)؛ لطفاً تصویر صفحه (JPG/PNG/WEBP) را بارگذاری کنید.';

/** تشخیص فایل PDF از روی امضای `%PDF-` در ابتدای بافر. */
export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

/* ------------------------------- اشیای PDF ------------------------------- */

interface PdfObject {
  num: number;
  dict: string;
  stream: Buffer | null;
}

/** یافتن کلیدواژه واقعی `stream` (با مرزهای معتبر) از موقعیت داده‌شده. */
function findStreamKeyword(text: string, from: number): number {
  let index = text.indexOf('stream', from);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + 'stream'.length];
    const beforeOk = before === undefined || /\s|>/.test(before);
    const afterOk = after === '\r' || after === '\n' || after === undefined;
    if (beforeOk && afterOk) {
      return index;
    }
    index = text.indexOf('stream', index + 'stream'.length);
  }
  return -1;
}

/** خواندن همه اشیای غیرمستقیم `N G obj … endobj` به‌همراه استریم احتمالی. */
function parseObjects(text: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(text)) !== null) {
    const num = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    let endobj = text.indexOf('endobj', bodyStart);
    if (endobj === -1) {
      endobj = text.length;
    }
    const streamIndex = findStreamKeyword(text, bodyStart);

    if (streamIndex !== -1 && streamIndex < endobj) {
      const dict = text.slice(bodyStart, streamIndex);
      let dataStart = streamIndex + 'stream'.length;
      if (text[dataStart] === '\r') {
        dataStart += 1;
      }
      if (text[dataStart] === '\n') {
        dataStart += 1;
      }
      const lengthMatch = /\/Length\s+(\d+)/.exec(dict);
      let dataEnd: number;
      if (lengthMatch) {
        dataEnd = Math.min(dataStart + Number(lengthMatch[1]), text.length);
      } else {
        const endstream = text.indexOf('endstream', dataStart);
        dataEnd = endstream === -1 ? endobj : endstream;
      }
      const stream = Buffer.from(text.slice(dataStart, dataEnd), 'latin1');
      objects.set(num, { num, dict, stream });
      objectPattern.lastIndex = dataEnd;
    } else {
      objects.set(num, { num, dict: text.slice(bodyStart, endobj), stream: null });
      objectPattern.lastIndex = endobj;
    }
  }
  return objects;
}

/** نخستین ارجاع غیرمستقیم `N G R` مطابق الگو در متن. */
function firstRef(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}

/** آخرین ارجاع `/Root N 0 R` در فایل (trailer). */
function findRootRef(text: string): number | null {
  const pattern = /\/Root\s+(\d+)\s+\d+\s+R/g;
  let last: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    last = Number(match[1]);
  }
  return last;
}

/** پیمایش درخت صفحه‌ها از یک گره `/Pages` و برگرداندن شماره صفحه‌ها به ترتیب. */
function collectPages(root: number, objects: Map<number, PdfObject>): number[] {
  const pages: number[] = [];
  const visited = new Set<number>();

  const visit = (num: number): void => {
    if (visited.has(num)) {
      return;
    }
    visited.add(num);
    const object = objects.get(num);
    if (!object) {
      return;
    }
    const type = /\/Type\s*\/(\w+)/.exec(object.dict)?.[1];
    if (type === 'Page') {
      pages.push(num);
      return;
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object.dict);
    if (!kids) {
      return;
    }
    const refPattern = /(\d+)\s+\d+\s+R/g;
    let match: RegExpExecArray | null;
    while ((match = refPattern.exec(kids[1])) !== null) {
      visit(Number(match[1]));
    }
  };

  const catalog = objects.get(root);
  const pagesRef = catalog
    ? firstRef(/\/Pages\s+(\d+)\s+\d+\s+R/, catalog.dict)
    : null;
  visit(pagesRef ?? root);
  return pages;
}

/* ---------------------------- دیکشنری/فونت/CMap ---------------------------- */

/** استخراج زیررشته یک دیکشنری `<< … >>` متوازن از موقعیت `start`. */
function extractBalancedDict(text: string, start: number): string | null {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text[index] === '<' && text[index + 1] === '<') {
      depth += 1;
      index += 2;
      continue;
    }
    if (text[index] === '>' && text[index + 1] === '>') {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        return text.slice(start, index);
      }
      continue;
    }
    index += 1;
  }
  return null;
}

/** دیکشنری `/Resources` صفحه (ارجاع یا درون‌خطی). */
function findResourcesDict(
  page: PdfObject,
  objects: Map<number, PdfObject>,
): string | null {
  const ref = firstRef(/\/Resources\s+(\d+)\s+\d+\s+R/, page.dict);
  if (ref !== null) {
    return objects.get(ref)?.dict ?? null;
  }
  const index = page.dict.indexOf('/Resources');
  if (index === -1) {
    return null;
  }
  const dictStart = page.dict.indexOf('<<', index);
  return dictStart === -1 ? null : extractBalancedDict(page.dict, dictStart);
}

/** نگاشت نام فونت (`/F1`) به شماره شیء از دیکشنری منابع. */
function findFontRefs(resourcesDict: string): Map<string, number> {
  const fonts = new Map<string, number>();
  const index = resourcesDict.indexOf('/Font');
  if (index === -1) {
    return fonts;
  }
  const dictStart = resourcesDict.indexOf('<<', index);
  if (dictStart === -1) {
    return fonts;
  }
  const fontDict = extractBalancedDict(resourcesDict, dictStart);
  if (!fontDict) {
    return fonts;
  }
  const pattern = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fontDict)) !== null) {
    fonts.set(match[1], Number(match[2]));
  }
  return fonts;
}

/** تبدیل رشته hex یک CMap به متن یونیکد (UTF-16BE). */
function hexToUnicode(hex: string): string {
  let out = '';
  for (let index = 0; index + 4 <= hex.length; index += 4) {
    out += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
  }
  if (out === '') {
    for (let index = 0; index + 2 <= hex.length; index += 2) {
      out += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
    }
  }
  return out;
}

/** تجزیه جدول `ToUnicode` (bfchar/bfrange) به نگاشت کد → متن. */
function parseToUnicode(stream: Buffer): Map<number, string> {
  const text = stream.toString('latin1');
  const map = new Map<number, string>();
  let match: RegExpExecArray | null;

  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((match = bfchar.exec(text)) !== null) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let entry: RegExpExecArray | null;
    while ((entry = pair.exec(match[1])) !== null) {
      map.set(parseInt(entry[1], 16), hexToUnicode(entry[2]));
    }
  }

  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrange.exec(text)) !== null) {
    const single = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let entry: RegExpExecArray | null;
    while ((entry = single.exec(match[1])) !== null) {
      const lo = parseInt(entry[1], 16);
      const hi = parseInt(entry[2], 16);
      const dst = parseInt(entry[3], 16);
      for (let code = lo; code <= hi && code - lo < 65536; code += 1) {
        map.set(code, String.fromCharCode(dst + (code - lo)));
      }
    }
    const array = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g;
    while ((entry = array.exec(match[1])) !== null) {
      const lo = parseInt(entry[1], 16);
      const destinations = [...entry[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) =>
        hexToUnicode(m[1]),
      );
      destinations.forEach((destination, offset) =>
        map.set(lo + offset, destination),
      );
    }
  }
  return map;
}

/** طول بایت کد از `begincodespacerange` (پیش‌فرض ۲ بایت). */
function codeByteLength(stream: Buffer): number {
  const match = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(
    stream.toString('latin1'),
  );
  if (!match) {
    return 2;
  }
  return Math.max(1, Math.ceil(match[1].length / 2));
}

/** رمزگشایی استریم با احترام به `FlateDecode`. */
function decodeStream(object: PdfObject): Buffer | null {
  if (!object.stream) {
    return null;
  }
  const filter = /\/Filter\s*(\/\w+|\[[^\]]*\])/.exec(object.dict);
  if (!filter || !filter[1].includes('FlateDecode')) {
    return object.stream;
  }
  try {
    return inflateSync(object.stream);
  } catch {
    return null;
  }
}

interface FontInfo {
  toUnicode: Map<number, string> | null;
  codeBytes: number;
}

/** ساخت نگاشت نام فونت → اطلاعات رمزگشایی برای یک صفحه. */
function buildPageFonts(
  page: PdfObject,
  objects: Map<number, PdfObject>,
): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const resourcesDict = findResourcesDict(page, objects);
  if (!resourcesDict) {
    return fonts;
  }
  for (const [name, ref] of findFontRefs(resourcesDict)) {
    const fontObject = objects.get(ref);
    if (!fontObject) {
      continue;
    }
    const isType0 = /\/Subtype\s*\/Type0/.test(fontObject.dict);
    const toUnicodeRef = firstRef(
      /\/ToUnicode\s+(\d+)\s+\d+\s+R/,
      fontObject.dict,
    );
    let toUnicode: Map<number, string> | null = null;
    let codeBytes = 1;
    if (toUnicodeRef !== null) {
      const cmap = objects.get(toUnicodeRef);
      const data = cmap ? decodeStream(cmap) : null;
      if (data) {
        toUnicode = parseToUnicode(data);
        codeBytes = codeByteLength(data);
      }
    }
    fonts.set(name, {
      toUnicode,
      codeBytes: isType0 ? Math.max(2, codeBytes) : 1,
    });
  }
  return fonts;
}

/* ------------------------------ تجزیه محتوا ------------------------------ */

type PdfToken =
  | { type: 'string'; value: Buffer }
  | { type: 'name'; value: string }
  | { type: 'number'; value: number }
  | { type: 'operator'; value: string }
  | { type: 'arrayStart' }
  | { type: 'arrayEnd' }
  | { type: 'dictStart' }
  | { type: 'dictEnd' };

const DELIMITERS = '()<>[]{}/%';

function isWhitespace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\r' ||
    char === '\n' ||
    char === '\f' ||
    char === '\0'
  );
}

/** نشانه‌گذاری (tokenize) یک استریم محتوا به عملگرها/رشته‌ها/اعداد. */
function tokenize(content: string): PdfToken[] {
  const tokens: PdfToken[] = [];
  const size = content.length;
  let index = 0;

  while (index < size) {
    const char = content[index];

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === '%') {
      while (index < size && content[index] !== '\n' && content[index] !== '\r') {
        index += 1;
      }
      continue;
    }
    if (char === '(') {
      index += 1;
      const bytes: number[] = [];
      let depth = 1;
      while (index < size && depth > 0) {
        const current = content[index];
        if (current === '\\') {
          const next = content[index + 1];
          index += 2;
          switch (next) {
            case 'n':
              bytes.push(10);
              break;
            case 'r':
              bytes.push(13);
              break;
            case 't':
              bytes.push(9);
              break;
            case 'b':
              bytes.push(8);
              break;
            case 'f':
              bytes.push(12);
              break;
            case '(':
              bytes.push(40);
              break;
            case ')':
              bytes.push(41);
              break;
            case '\\':
              bytes.push(92);
              break;
            case '\r':
              if (content[index] === '\n') {
                index += 1;
              }
              break;
            case '\n':
              break;
            default:
              if (next !== undefined && next >= '0' && next <= '7') {
                let octal = next;
                while (
                  octal.length < 3 &&
                  content[index] >= '0' &&
                  content[index] <= '7'
                ) {
                  octal += content[index];
                  index += 1;
                }
                bytes.push(parseInt(octal, 8) & 0xff);
              } else if (next !== undefined) {
                bytes.push(next.charCodeAt(0) & 0xff);
              }
          }
          continue;
        }
        if (current === '(') {
          depth += 1;
          bytes.push(40);
          index += 1;
          continue;
        }
        if (current === ')') {
          depth -= 1;
          index += 1;
          if (depth === 0) {
            break;
          }
          bytes.push(41);
          continue;
        }
        bytes.push(current.charCodeAt(0) & 0xff);
        index += 1;
      }
      tokens.push({ type: 'string', value: Buffer.from(bytes) });
      continue;
    }
    if (char === '<') {
      if (content[index + 1] === '<') {
        tokens.push({ type: 'dictStart' });
        index += 2;
        continue;
      }
      index += 1;
      let hex = '';
      while (index < size && content[index] !== '>') {
        hex += content[index];
        index += 1;
      }
      index += 1;
      const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
      const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
      tokens.push({ type: 'string', value: Buffer.from(padded, 'hex') });
      continue;
    }
    if (char === '>') {
      if (content[index + 1] === '>') {
        tokens.push({ type: 'dictEnd' });
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === '[') {
      tokens.push({ type: 'arrayStart' });
      index += 1;
      continue;
    }
    if (char === ']') {
      tokens.push({ type: 'arrayEnd' });
      index += 1;
      continue;
    }
    if (char === '/' || char === '{' || char === '}') {
      if (char !== '/') {
        index += 1;
        continue;
      }
      index += 1;
      const start = index;
      while (
        index < size &&
        !isWhitespace(content[index]) &&
        !DELIMITERS.includes(content[index])
      ) {
        index += 1;
      }
      tokens.push({ type: 'name', value: content.slice(start, index) });
      continue;
    }
    if (
      (char >= '0' && char <= '9') ||
      char === '-' ||
      char === '+' ||
      char === '.'
    ) {
      const start = index;
      index += 1;
      while (index < size && /[0-9.+\-eE]/.test(content[index])) {
        index += 1;
      }
      const value = Number(content.slice(start, index));
      tokens.push({ type: 'number', value: Number.isFinite(value) ? value : 0 });
      continue;
    }

    const start = index;
    while (
      index < size &&
      !isWhitespace(content[index]) &&
      !DELIMITERS.includes(content[index])
    ) {
      index += 1;
    }
    if (index === start) {
      index += 1;
      continue;
    }
    tokens.push({ type: 'operator', value: content.slice(start, index) });
  }
  return tokens;
}

interface TextItem {
  x: number;
  y: number;
  text: string;
  size: number;
}

type Operand = string | number | Buffer | Array<string | number>;

/** اجرای عملگرهای متنی یک صفحه و جمع‌آوری متن با مختصات. */
function extractPageItems(
  content: string,
  fonts: Map<string, FontInfo>,
): TextItem[] {
  const tokens = tokenize(content);
  const items: TextItem[] = [];
  let stack: Operand[] = [];
  let tmE = 0;
  let tmF = 0;
  let size = 12;
  let leading = 0;
  let font: FontInfo | null = null;

  const decode = (bytes: Buffer): string => {
    let out = '';
    if (font && font.codeBytes === 2) {
      for (let index = 0; index + 1 < bytes.length; index += 2) {
        const code = (bytes[index] << 8) | bytes[index + 1];
        out += font.toUnicode?.get(code) ?? String.fromCharCode(code);
      }
      return out;
    }
    for (const byte of bytes) {
      out += font?.toUnicode?.get(byte) ?? String.fromCharCode(byte);
    }
    return out;
  };

  const show = (bytes: Buffer): void => {
    const text = decode(bytes);
    if (text) {
      items.push({ x: tmE, y: tmF, text, size });
    }
    tmE += text.length * size * 0.5;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === 'arrayStart') {
      const array: Array<string | number> = [];
      let depth = 1;
      index += 1;
      while (index < tokens.length && depth > 0) {
        const inner = tokens[index];
        if (inner.type === 'arrayStart') {
          depth += 1;
        } else if (inner.type === 'arrayEnd') {
          depth -= 1;
        } else if (depth === 1) {
          if (inner.type === 'string') {
            array.push(inner.value.toString('latin1'));
          } else if (inner.type === 'number') {
            array.push(inner.value);
          }
        }
        index += 1;
      }
      index -= 1;
      stack.push(array);
      continue;
    }

    if (token.type === 'string') {
      stack.push(token.value);
      continue;
    }
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }
    if (token.type === 'name') {
      stack.push(token.value);
      continue;
    }
    if (token.type === 'dictStart') {
      stack.push(null as unknown as Operand);
      continue;
    }
    if (token.type === 'dictEnd' || token.type === 'arrayEnd') {
      stack.pop();
      continue;
    }

    const operator = token.value;
    const last = stack[stack.length - 1];
    const secondLast = stack[stack.length - 2];

    if (operator === 'Tf') {
      if (typeof last === 'number') {
        size = last;
      }
      if (typeof secondLast === 'string') {
        font = fonts.get(secondLast) ?? null;
      }
    } else if (operator === 'Td' || operator === 'TD') {
      if (typeof secondLast === 'number') {
        tmE += secondLast;
      }
      if (typeof last === 'number') {
        tmF += last;
        if (operator === 'TD') {
          leading = -last;
        }
      }
    } else if (operator === 'Tm') {
      const e = stack[stack.length - 2];
      const f = stack[stack.length - 1];
      if (typeof e === 'number') {
        tmE = e;
      }
      if (typeof f === 'number') {
        tmF = f;
      }
    } else if (operator === 'TL') {
      if (typeof last === 'number') {
        leading = last;
      }
    } else if (operator === 'T*') {
      tmF -= leading;
    } else if (operator === 'Tj') {
      if (Buffer.isBuffer(last)) {
        show(last);
      }
    } else if (operator === 'TJ') {
      if (Array.isArray(last)) {
        for (const element of last) {
          if (typeof element === 'string') {
            show(Buffer.from(element, 'latin1'));
          } else {
            tmE -= (element / 1000) * size;
          }
        }
      }
    } else if (operator === "'" || operator === '"') {
      tmF -= leading;
      if (Buffer.isBuffer(last)) {
        show(last);
      }
    }
    stack = [];
  }

  return items;
}

/* ------------------------------ ساخت جدول ------------------------------ */

/** شکستن متن‌های یک خط به سلول‌ها بر پایه فاصله افقی. */
function lineToCells(lineItems: TextItem[]): string[] {
  const ordered = [...lineItems].sort((a, b) => a.x - b.x);
  const cells: string[] = [];
  let current = '';
  let previousEnd: number | null = null;

  for (const item of ordered) {
    if (previousEnd !== null && item.x - previousEnd > item.size * 1.5) {
      cells.push(current.trim());
      current = item.text;
    } else {
      if (
        current !== '' &&
        !current.endsWith(' ') &&
        !item.text.startsWith(' ')
      ) {
        current += ' ';
      }
      current += item.text;
    }
    previousEnd = item.x + item.text.length * item.size * 0.5;
  }
  cells.push(current.trim());
  return cells;
}

/** تبدیل متن‌های مختصات‌دار به سربرگ + ردیف‌های جدول. */
function itemsToTable(items: TextItem[]): ParsedTable {
  const lines = new Map<number, TextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y / 3);
    const bucket = lines.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      lines.set(key, [item]);
    }
  }

  const orderedLines = [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map((entry) => entry[1]);

  const tableRows: string[][] = [];
  for (const lineItems of orderedLines) {
    const cells = lineToCells(lineItems);
    if (cells.some((cell) => cell !== '')) {
      tableRows.push(cells);
    }
  }

  if (tableRows.length === 0) {
    throw new ScannedPdfError(SCANNED_PDF_MESSAGE);
  }

  const headers = tableRows[0];
  const dataRows = tableRows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new PdfParseError(
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

/** ارجاع‌های استریم محتوای یک صفحه (`/Contents`). */
function pageContentRefs(
  page: PdfObject,
  objects: Map<number, PdfObject>,
): number[] {
  const refs: number[] = [];
  const arrayMatch = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
  if (arrayMatch) {
    const pattern = /(\d+)\s+\d+\s+R/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(arrayMatch[1])) !== null) {
      refs.push(Number(match[1]));
    }
    return refs;
  }
  const ref = firstRef(/\/Contents\s+(\d+)\s+\d+\s+R/, page.dict);
  if (ref !== null) {
    refs.push(ref);
  }
  return refs;
}

/**
 * تجزیه PDF متنی (بافر) به سربرگ و ردیف‌های جدول.
 *
 * حجم بیش از ۵ مگابایت، فایل نامعتبر و PDF اسکن‌شده (بدون متن) با خطای فارسی
 * رد می‌شوند. برای PDF اسکن‌شده `ScannedPdfError` پرتاب می‌شود تا فراخوان
 * پیام اختصاصی «تصویر بفرستید» را نشان دهد.
 */
export function parsePdf(input: Buffer): ParsedTable {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new PdfParseError('حجم فایل PDF بیش از ۵ مگابایت است.');
  }
  if (!isPdf(buffer)) {
    throw new PdfParseError(INVALID_PDF_MESSAGE);
  }

  const text = buffer.toString('latin1');
  const objects = parseObjects(text);
  if (objects.size === 0) {
    throw new PdfParseError(INVALID_PDF_MESSAGE);
  }

  const root = findRootRef(text);
  let pages = root !== null ? collectPages(root, objects) : [];
  if (pages.length === 0) {
    pages = [...objects.values()]
      .filter((object) => /\/Type\s*\/Page\b/.test(object.dict))
      .map((object) => object.num);
  }
  if (pages.length === 0) {
    throw new ScannedPdfError(SCANNED_PDF_MESSAGE);
  }

  const items: TextItem[] = [];
  for (const pageNum of pages) {
    const page = objects.get(pageNum);
    if (!page) {
      continue;
    }
    const fonts = buildPageFonts(page, objects);
    for (const ref of pageContentRefs(page, objects)) {
      const content = objects.get(ref);
      const decoded = content ? decodeStream(content) : null;
      if (decoded) {
        items.push(...extractPageItems(decoded.toString('latin1'), fonts));
      }
    }
  }

  if (items.length === 0) {
    throw new ScannedPdfError(SCANNED_PDF_MESSAGE);
  }
  return itemsToTable(items);
}
