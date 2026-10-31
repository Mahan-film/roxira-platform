/**
 * خوانندگان قالب‌های متنی: CSV/TSV، متن عرض‌ثابت، JSON، XML، جدول HTML (خروجی «xls» بسیاری از
 * نرم‌افزارهای ایرانی که در واقع HTML است).
 */

import { detectDelimiter, parseCsv } from '../parsers/csv.parser';
import { InMemoryTableReader, ParsedPackage } from '../parsers/package-source.types';
import { READER_LIMITS, rowLimit } from './limits';
import { decodeText } from './persian/text-decode';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, sanitiseTableName, TableNotes, uniqueTableName } from './tabular';
import { childrenNamed, decodeXmlEntities, parseXml, XmlNode } from './xml-lite';

export function packageOf(
  formatId: string,
  tables: Array<InMemoryTableReader | null>,
  notes: TableNotes,
  extraNotes: string[] = [],
): ParsedPackage {
  const present = tables.filter((t): t is InMemoryTableReader => t !== null);
  if (present.length === 0) {
    throw new ReaderError('فایل هیچ ردیف داده‌ای ندارد.');
  }
  if (present.length > READER_LIMITS.maxTables) {
    throw new ReaderError('تعداد جدول‌های فایل بیش از سقف مجاز است.');
  }
  return {
    tables: present,
    relationships: [],
    formatId,
    notes: [...extraNotes, ...notes.toList()],
    close: () => undefined,
  };
}

/** نمونهٔ متنی سبک (latin1) فقط برای تشخیص ساختار؛ رمزگشایی واقعی در read انجام می‌شود. */
export function headText(buffer: Buffer, bytes = 16_384): string {
  return buffer.subarray(0, bytes).toString('latin1');
}

function firstNonSpace(buffer: Buffer): number {
  for (let i = 0; i < Math.min(buffer.length, 4096); i += 1) {
    const b = buffer[i];
    if (b === 0xef || b === 0xbb || b === 0xbf || b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      continue;
    }
    return b;
  }
  return -1;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) {
      control += 1;
    }
  }
  // UTF-16 text has NULs; callers that accept it check separately.
  return control > Math.max(2, sample.length * 0.05);
}

function isUtf16Text(buffer: Buffer): boolean {
  return (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff)
  );
}

/* --------------------------------- CSV / TSV -------------------------------- */

function delimiterConsistency(text: string, delimiter: string): number {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 40);
  if (lines.length < 2) return lines.length === 1 && lines[0].split(delimiter).length > 1 ? 0.75 : 0;
  const counts = lines.map((l) => l.split(delimiter).length - 1);
  const mode = [...counts].sort((a, b) => b - a)[Math.floor(counts.length / 2)];
  if (mode === 0) return 0;
  const agree = counts.filter((c) => c === mode).length;
  return agree / counts.length;
}

export const csvReader: FormatReader = {
  id: 'csv',
  labelFa: 'CSV / متن جداشده',
  extensions: ['.csv', '.txt'],
  detect(buffer, fileName) {
    if ((looksBinary(buffer) && !isUtf16Text(buffer)) || buffer.length === 0) return 0;
    let text = isUtf16Text(buffer) ? buffer.toString('utf16le') : headText(buffer);
    if (buffer.length > 16_384) {
      text = text.slice(0, text.lastIndexOf('\n') + 1); // drop the line cut by the sample boundary
    }
    const delimiter = detectDelimiter(text);
    const consistency = delimiterConsistency(text, delimiter);
    if (consistency < 0.7) return 0;
    const ext = /\.(csv|tsv)$/i.test(fileName) ? 0.1 : 0;
    return 0.5 + consistency * 0.2 + ext;
  },
  read(buffer) {
    const decoded = decodeText(buffer);
    const delimiter = detectDelimiter(decoded.text.slice(0, 20_000));
    const parsed = parseCsv(decoded.text, rowLimit());
    const notes = new TableNotes();
    const table = buildTable('data', [parsed.headers, ...parsed.rows], notes);
    const pkg = packageOf(delimiter === '\t' ? 'tsv' : 'csv', [table], notes, decoded.notes);
    return pkg;
  },
};

/* ------------------------------- متن عرض‌ثابت ------------------------------ */

export const fixedWidthReader: FormatReader = {
  id: 'fixed-width',
  labelFa: 'متن با ستون‌های عرض‌ثابت',
  extensions: ['.txt', '.prn', '.dat'],
  detect(buffer) {
    if (looksBinary(buffer) || buffer.length < 40) return 0;
    const lines = headText(buffer).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 60);
    if (lines.length < 3) return 0;
    const cuts = findGutters(lines);
    return cuts.length >= 2 ? 0.3 : 0;
  },
  read(buffer) {
    const decoded = decodeText(buffer);
    const allLines = decoded.text.split(/\r?\n/);
    if (allLines.length > rowLimit() + 50) {
      throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
    }
    const lines = allLines.filter((l) => l.trim() !== '' && !/^[\s\-=_+|]+$/.test(l));
    const cuts = findGutters(lines.slice(0, 500));
    if (cuts.length < 2) {
      throw new ReaderError('ساختار ستونی ثابت در این متن پیدا نشد؛ آن را به‌صورت CSV یا اکسل بفرستید.');
    }
    const bounds = [0, ...cuts, Number.MAX_SAFE_INTEGER];
    const matrix = lines.map((line) => {
      const row: string[] = [];
      for (let i = 0; i < bounds.length - 1; i += 1) {
        row.push(line.slice(bounds[i], bounds[i + 1]).trim());
      }
      return row;
    });
    const notes = new TableNotes();
    return packageOf('fixed-width', [buildTable('data', matrix, notes)], notes, decoded.notes);
  },
};

/**
 * ستون‌هایی که در تقریباً همهٔ خطوط فاصله‌اند. فقط «دنباله‌های دست‌کم دوفاصله‌ای» جداکننده‌اند تا یک فاصلهٔ
 * تکی داخل سربرگ («شماره سند») ستون را نشکند.
 */
export function findGutters(lines: string[]): number[] {
  const width = Math.min(Math.max(...lines.map((l) => l.length)), 512);
  const isBlank: boolean[] = [];
  for (let col = 0; col < width; col += 1) {
    let blanks = 0;
    for (const line of lines) {
      if (col >= line.length || line[col] === ' ') blanks += 1;
    }
    isBlank.push(blanks >= lines.length * 0.97);
  }
  const cuts: number[] = [];
  let run = 0;
  for (let col = 0; col < width; col += 1) {
    if (isBlank[col]) {
      run += 1;
    } else {
      if (run >= 2 && cuts.length < READER_LIMITS.maxColumns) cuts.push(col);
      run = 0;
    }
  }
  return cuts;
}

/* ----------------------------------- JSON ---------------------------------- */

function assertJsonDepth(text: string): void {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      depth += 1;
      if (depth > READER_LIMITS.maxJsonDepth) {
        throw new ReaderError('عمق تودرتوی JSON بیش از سقف مجاز است.');
      }
    } else if (ch === '}' || ch === ']') depth -= 1;
  }
}

function flatten(value: unknown, prefix: string, out: Record<string, unknown>, depth: number): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && depth < 3) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__') continue;
      flatten(child, prefix ? `${prefix}.${key}` : key, out, depth + 1);
    }
    return;
  }
  out[prefix || 'value'] =
    value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

function objectsToMatrix(items: unknown[]): unknown[][] {
  const headers: string[] = [];
  const seen = new Set<string>();
  const flat = items.map((item) => {
    const row: Record<string, unknown> = {};
    flatten(item, '', row, 0);
    for (const key of Object.keys(row)) {
      if (!seen.has(key) && headers.length < READER_LIMITS.maxColumns) {
        seen.add(key);
        headers.push(key);
      }
    }
    return row;
  });
  return [headers, ...flat.map((row) => headers.map((h) => row[h]))];
}

export const jsonReader: FormatReader = {
  id: 'json',
  labelFa: 'JSON',
  extensions: ['.json', '.jsonl'],
  detect(buffer) {
    const first = firstNonSpace(buffer);
    if (first !== 0x7b && first !== 0x5b) return 0;
    const head = headText(buffer, 2048).trimStart();
    if (/^\{\s*"/.test(head) || /^\[\s*(\{|\[|"|\d)/.test(head) || /^\[\s*\]/.test(head)) return 0.85;
    return 0.2;
  },
  read(buffer) {
    if (buffer.length > READER_LIMITS.maxTreeBytes) {
      throw new ReaderError('حجم فایل JSON بیش از سقف مجاز است؛ آن را به CSV تبدیل کنید.');
    }
    const decoded = decodeText(buffer);
    assertJsonDepth(decoded.text);
    let data: unknown;
    try {
      data = JSON.parse(decoded.text);
    } catch {
      throw new ReaderError('فایل JSON معتبر نیست.');
    }
    const notes = new TableNotes();
    const used = new Set<string>();
    const tables: Array<InMemoryTableReader | null> = [];
    const add = (name: string, items: unknown[]): void => {
      if (items.length > rowLimit()) {
        throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
      }
      if (items.length === 0) return;
      const arrayRows = items.every(Array.isArray);
      const matrix = arrayRows ? (items as unknown[][]) : objectsToMatrix(items);
      tables.push(buildTable(uniqueTableName(sanitiseTableName(name), used), matrix, notes));
    };
    if (Array.isArray(data)) {
      add('data', data);
    } else if (data !== null && typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>).filter(
        ([, v]) => Array.isArray(v) && (v as unknown[]).length > 0,
      );
      if (entries.length > 0) {
        for (const [key, value] of entries) add(key, value as unknown[]);
      } else {
        add('data', [data]);
      }
    }
    return packageOf('json', tables, notes, decoded.notes);
  },
};

/* ----------------------------------- XML ----------------------------------- */

function recordFromNode(node: XmlNode): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const put = (key: string, value: string): void => {
    if (!(key in row)) row[key] = value;
  };
  const walk = (n: XmlNode, prefix: string, depth: number): void => {
    for (const [attr, value] of Object.entries(n.attrs)) {
      put(prefix ? `${prefix}.${attr}` : attr, value);
    }
    for (const child of n.children) {
      const key = prefix ? `${prefix}.${child.name}` : child.name;
      if (child.children.length === 0) {
        put(key, child.text.trim());
        for (const [attr, value] of Object.entries(child.attrs)) put(`${key}.${attr}`, value);
      } else if (depth < 2) {
        walk(child, key, depth + 1);
      }
    }
  };
  walk(node, '', 0);
  return row;
}

/** گروه‌های رکورد تکرارشونده در درخت XML: همهٔ عناصر هم‌نام با ≥۲ نمونه (یا تنها گروه). */
export function xmlTables(root: XmlNode): Array<{ name: string; records: XmlNode[] }> {
  const groups = new Map<string, XmlNode[]>();
  const visit = (node: XmlNode, depth: number): void => {
    const byName = new Map<string, XmlNode[]>();
    for (const child of node.children) {
      const list = byName.get(child.name) ?? [];
      list.push(child);
      byName.set(child.name, list);
    }
    for (const [name, list] of byName) {
      const hasFields = list.some((n) => n.children.length > 0 || Object.keys(n.attrs).length > 0);
      if (list.length >= 2 && hasFields) {
        const existing = groups.get(name) ?? [];
        groups.set(name, existing.concat(list));
      } else {
        for (const item of list) if (depth < READER_LIMITS.maxXmlDepth) visit(item, depth + 1);
      }
    }
  };
  visit(root, 0);
  if (groups.size === 0 && root.children.length > 0) {
    // single record document: <root><a>1</a><b>2</b></root>
    return [{ name: root.name, records: [root] }];
  }
  return [...groups.entries()].map(([name, records]) => ({ name, records }));
}

export const xmlReader: FormatReader = {
  id: 'xml',
  labelFa: 'XML',
  extensions: ['.xml'],
  detect(buffer) {
    if (firstNonSpace(buffer) !== 0x3c) return 0;
    const head = headText(buffer, 4096);
    if (/<OFX[\s>]/i.test(head) || /OFXHEADER/i.test(head)) return 0;
    if (/<html[\s>]|<table[\s>]/i.test(head)) return 0;
    return /^\s*(\xef\xbb\xbf)?<(\?xml|[A-Za-z_])/.test(head) ? 0.8 : 0;
  },
  read(buffer) {
    if (buffer.length > READER_LIMITS.maxTreeBytes) {
      throw new ReaderError('حجم فایل XML بیش از سقف مجاز است.');
    }
    const decoded = decodeText(buffer);
    const root = parseXml(decoded.text);
    const notes = new TableNotes();
    const used = new Set<string>();
    const tables = xmlTables(root).map(({ name, records }) => {
      if (records.length > rowLimit()) {
        throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
      }
      const flat = records.map(recordFromNode);
      return buildTable(uniqueTableName(sanitiseTableName(name), used), objectsToMatrix(flat), notes);
    });
    return packageOf('xml', tables, notes, decoded.notes);
  },
};

/* ------------------------------- جدول HTML (xls) ------------------------------ */

function htmlCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const pattern = /<t[dh]\b[^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rowHtml)) !== null) {
    cells.push(
      decodeXmlEntities(
        match[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&zwnj;/gi, '‌'),
      ).trim(),
    );
  }
  return cells;
}

export const htmlTableReader: FormatReader = {
  id: 'html-table',
  labelFa: 'جدول HTML (اکسل قدیمی/خروجی نرم‌افزار)',
  extensions: ['.xls', '.html', '.htm'],
  detect(buffer) {
    if (looksBinary(buffer) && !isUtf16Text(buffer)) return 0;
    const head = (isUtf16Text(buffer) ? buffer.toString('utf16le') : headText(buffer, 32_768));
    return /<table[\s>]/i.test(head) && /<t[dr][\s>]/i.test(head) ? 0.8 : 0;
  },
  read(buffer) {
    if (buffer.length > READER_LIMITS.maxTreeBytes) {
      throw new ReaderError('حجم فایل بیش از سقف مجاز است.');
    }
    const decoded = decodeText(buffer);
    const notes = new TableNotes();
    const used = new Set<string>();
    const tables: Array<InMemoryTableReader | null> = [];
    const tablePattern = /<table\b[\s\S]*?<\/table>/gi;
    let tableMatch: RegExpExecArray | null;
    let index = 0;
    while ((tableMatch = tablePattern.exec(decoded.text)) !== null && index < READER_LIMITS.maxTables) {
      const rows: string[][] = [];
      const rowPattern = /<tr\b[\s\S]*?(?=<\/tr>|<tr\b|$)/gi;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowPattern.exec(tableMatch[0])) !== null) {
        rows.push(htmlCells(rowMatch[0]));
        if (rows.length > rowLimit() + 50) {
          throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
        }
      }
      index += 1;
      tables.push(
        buildTable(uniqueTableName(`table_${index}`, used), rows, notes, { autoHeader: true }),
      );
    }
    return packageOf('html-table', tables, notes, decoded.notes);
  },
};

export { childrenNamed };
