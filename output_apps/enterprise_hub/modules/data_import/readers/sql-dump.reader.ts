/**
 * خواندن دامپ‌های متنی MySQL/MariaDB، PostgreSQL (با بلوک‌های COPY) و اسکریپت T-SQL — «بدون اجرا».
 *
 * هیچ موتور SQL‌ای وجود ندارد: متن توکن‌بندی می‌شود، فقط CREATE TABLE (نام ستون‌ها و کلید خارجی)،
 * INSERT ... VALUES و COPY ... FROM stdin به داده تبدیل می‌شوند و هر دستور دیگر (DROP، GRANT،
 * CREATE FUNCTION/TRIGGER، SET، ATTACH، دستورهای پشته‌ای …) فقط شمرده و نادیده گرفته می‌شود.
 */

import { rowLimit, READER_LIMITS } from './limits';
import { InMemoryTableReader, PackageRelationship } from '../parsers/package-source.types';
import { decodeText } from './persian/text-decode';
import { FormatReader, ReaderError } from './reader.types';
import { cleanCell, cleanHeaders, sanitiseTableName, TableNotes } from './tabular';

export type DumpDialect = 'mysql' | 'postgres' | 'mssql';

export function detectDumpDialect(text: string): DumpDialect | null {
  const head = text.slice(0, 300_000);
  if (/^\s*COPY\s+\S+.*\bFROM\s+stdin\b/im.test(head) || /PostgreSQL database dump/i.test(head) || /^\s*SET\s+(statement_timeout|client_encoding|standard_conforming_strings)\b/im.test(head) || /\bSELECT\s+pg_catalog\./i.test(head)) {
    return 'postgres';
  }
  if (/^\s*--\s*(MySQL|MariaDB) dump/im.test(head) || /\/\*!\d{5}/.test(head) || /\bENGINE\s*=\s*\w+/i.test(head) || /^\s*LOCK\s+TABLES\b/im.test(head) || (/\bAUTO_INCREMENT\b/i.test(head) && /`/.test(head)) || /^\s*INSERT\s+INTO\s+`/im.test(head)) {
    return 'mysql';
  }
  if (/^\s*GO\s*$/im.test(head) || /^\s*SET\s+(ANSI_NULLS|QUOTED_IDENTIFIER|ANSI_PADDING)\b/im.test(head) || /\[dbo\]\./i.test(head) || /^\s*INSERT\s+\[?\w+\]?\.\[/im.test(head)) {
    return 'mssql';
  }
  return null;
}

/* ------------------------------ اسکنر دستورها ----------------------------- */

interface Scanner {
  text: string;
  pos: number;
  dialect: DumpDialect;
  delimiter: string;
}

/** نمونهٔ یک دستور: متن + اینکه یک بلوک COPY دنبال دارد یا نه. */
function nextStatement(sc: Scanner): string | null {
  const { text } = sc;
  const len = text.length;
  let i = sc.pos;
  let start = i;
  const delim = sc.delimiter;
  const backslash = sc.dialect === 'mysql';
  while (i < len) {
    const ch = text.charCodeAt(i);
    // line-level directives
    if (i === start || text.charCodeAt(i - 1) === 10) {
      const lineEnd = text.indexOf('\n', i);
      const line = text.slice(i, lineEnd === -1 ? len : lineEnd);
      if (sc.dialect === 'mysql' && /^DELIMITER\s+\S+/i.test(line)) {
        sc.delimiter = line.trim().split(/\s+/)[1];
        i = lineEnd === -1 ? len : lineEnd + 1;
        start = i;
        continue;
      }
      if (
        sc.dialect === 'mssql' &&
        i > start &&
        /^\s*(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE|SET|USE|GRANT|EXEC)\b/i.test(line) &&
        text.slice(start, i).trim() !== ''
      ) {
        // T-SQL batches may hold several statements with no terminator between them
        const stmt = text.slice(start, i).trim();
        sc.pos = i;
        return stmt;
      }
      if (sc.dialect === 'mssql' && /^\s*GO\s*$/i.test(line)) {
        const stmt = text.slice(start, i).trim();
        sc.pos = lineEnd === -1 ? len : lineEnd + 1;
        if (stmt) return stmt;
        i = sc.pos;
        start = i;
        continue;
      }
    }
    if (ch === 39) { // '
      const escapes = backslash || (sc.dialect === 'postgres' && i > 0 && (text[i - 1] === 'E' || text[i - 1] === 'e'));
      i += 1;
      while (i < len) {
        const c = text.charCodeAt(i);
        if (escapes && c === 92) { i += 2; continue; }
        if (c === 39) {
          if (text.charCodeAt(i + 1) === 39) { i += 2; continue; }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === 34 || ch === 96) { // " `
      const close = text.indexOf(String.fromCharCode(ch), i + 1);
      i = close === -1 ? len : close + 1;
      continue;
    }
    if (ch === 91 && sc.dialect === 'mssql') { // [
      const close = text.indexOf(']', i + 1);
      i = close === -1 ? len : close + 1;
      continue;
    }
    if (ch === 36 && sc.dialect === 'postgres') { // $tag$ ... $tag$
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        i = close === -1 ? len : close + m[0].length;
        continue;
      }
    }
    if (ch === 45 && text.charCodeAt(i + 1) === 45) { // --
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? len : nl;
      continue;
    }
    if (ch === 35 && sc.dialect === 'mysql' && (i === start || text.charCodeAt(i - 1) === 10)) { // # comment
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? len : nl;
      continue;
    }
    if (ch === 47 && text.charCodeAt(i + 1) === 42) { // /* */
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? len : close + 2;
      continue;
    }
    if (text.startsWith(delim, i) && sc.dialect !== 'mssql') {
      const stmt = text.slice(start, i).trim();
      sc.pos = i + delim.length;
      return stmt;
    }
    i += 1;
  }
  const tail = text.slice(start).trim();
  sc.pos = len;
  return tail || null;
}

/** حذف کامنت‌های ابتدای دستور. */
function stripLeading(stmt: string): string {
  let s = stmt.trimStart();
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2).trimStart();
    } else if (s.startsWith('#')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart();
    } else {
      return s;
    }
  }
}

/* ------------------------------- شناسه‌ها --------------------------------- */

/** نام (احتمالاً نقل‌قول‌دار و schema‌دار) در ابتدای رشته؛ برمی‌گرداند نام آخر و باقی متن. */
function readQualifiedName(s: string): { name: string; rest: string } | null {
  let rest = s.trimStart();
  let last = '';
  let guard = 0;
  while (guard < 4) {
    guard += 1;
    const m = /^(?:`((?:[^`]|``)*)`|"((?:[^"]|"")*)"|\[([^\]]*)\]|([A-Za-z0-9_$\u0080-￿]+))/.exec(rest);
    if (!m) return last ? { name: last, rest } : null;
    last = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    rest = rest.slice(m[0].length);
    const dot = /^\s*\.\s*/.exec(rest);
    if (!dot) return { name: last, rest };
    rest = rest.slice(dot[0].length);
  }
  return { name: last, rest };
}

function splitTopLevel(body: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\' && quote === "'") i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function balancedParens(s: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === "'") i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') quote = ']';
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ------------------------------ CREATE TABLE ------------------------------ */

interface TableDef {
  name: string;
  columns: string[];
  types: string[];
}

const CONSTRAINT_START = /^(PRIMARY\s+KEY|KEY|UNIQUE|CONSTRAINT|INDEX|FOREIGN\s+KEY|CHECK|FULLTEXT|SPATIAL|EXCLUDE|PERIOD|LIKE)\b/i;

function parseCreateTable(stmt: string, rels: PackageRelationship[]): TableDef | null {
  const m = /^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(stmt);
  if (!m) return null;
  const named = readQualifiedName(stmt.slice(m[0].length));
  if (!named) return null;
  const open = named.rest.indexOf('(');
  if (open === -1 || /^\s*(AS|LIKE)\b/i.test(named.rest)) return null;
  const close = balancedParens(named.rest, open);
  if (close === -1) return null;
  const columns: string[] = [];
  const types: string[] = [];
  for (const part of splitTopLevel(named.rest.slice(open + 1, close))) {
    const def = part.trim();
    if (!def) continue;
    const fk = /(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(def);
    if (fk) {
      const from = readQualifiedName(fk[1].split(',')[0]);
      const toTable = readQualifiedName(fk[2]);
      const to = readQualifiedName(fk[3].split(',')[0]);
      if (from && toTable && to) {
        rels.push({ fromTable: named.name, fromColumn: from.name, toTable: toTable.name, toColumn: to.name, declared: true });
      }
      continue;
    }
    if (CONSTRAINT_START.test(def)) continue;
    const col = readQualifiedName(def);
    if (!col) continue;
    columns.push(col.name);
    types.push(col.rest.trim().split(/\s+/)[0] ?? '');
  }
  return columns.length > 0 ? { name: named.name, columns, types } : null;
}

/* ------------------------------- مقادیر INSERT ------------------------------ */

const NULL = Symbol('null');

function readValue(s: string, i: number, backslash: boolean): { value: string | typeof NULL; next: number } {
  while (i < s.length && /\s/.test(s[i])) i += 1;
  // charset introducers / N / E prefixes
  const prefix = /^(?:_[A-Za-z0-9]+\s*|N|E|e|n)(?=')/.exec(s.slice(i, i + 24));
  let esc = backslash;
  if (prefix) {
    if (/^[Ee]/.test(prefix[0])) esc = true;
    i += prefix[0].length;
  }
  if (s[i] === "'") {
    let out = '';
    i += 1;
    while (i < s.length) {
      const ch = s[i];
      if (esc && ch === '\\') {
        const n = s[i + 1];
        const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', Z: '\x1a' };
        out += n === undefined ? '' : (map[n] ?? n);
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        i += 1;
        break;
      }
      out += ch;
      i += 1;
    }
    return { value: out, next: i };
  }
  const bit = /^(?:[xX]|[bB])'([0-9a-fA-F01]*)'/.exec(s.slice(i, i + 4096));
  if (bit) {
    return { value: s[i].toLowerCase() === 'x' ? bit[1] : bit[1], next: i + bit[0].length };
  }
  // bare token up to , or ) at depth 0 (numbers, NULL, 0xHEX, functions, TRUE)
  let depth = 0;
  let j = i;
  let quote = '';
  for (; j < s.length; j += 1) {
    const ch = s[j];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === ',' && depth === 0) break;
  }
  const token = s.slice(i, j).trim();
  if (/^null$/i.test(token)) return { value: NULL, next: j };
  return { value: token, next: j };
}

function parseTuples(s: string, from: number, backslash: boolean, limit: number, onRow: (row: Array<string | typeof NULL>) => void): void {
  let i = from;
  let rows = 0;
  while (i < s.length) {
    while (i < s.length && s[i] !== '(') {
      if (s[i] === ';') return;
      i += 1;
    }
    if (i >= s.length) return;
    i += 1;
    const row: Array<string | typeof NULL> = [];
    for (;;) {
      const { value, next } = readValue(s, i, backslash);
      row.push(value);
      i = next;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (s[i] === ',') { i += 1; continue; }
      if (s[i] === ')') { i += 1; break; }
      throw new ReaderError('دستور INSERT در دامپ قابل تفسیر نیست.');
    }
    rows += 1;
    if (rows > limit) throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
    onRow(row);
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (s[i] !== ',') return; // end of the VALUES list: anything after is not a tuple
  }
}

/* --------------------------------- COPY ----------------------------------- */

function unescapeCopy(field: string): string | typeof NULL {
  if (field === '\\N') return NULL;
  if (!field.includes('\\')) return field;
  return field.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|(.))/g, (_w, oct: string, hex: string, ch: string) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
    return map[ch] ?? ch;
  });
}

/* ------------------------------- خواننده ---------------------------------- */

interface TableData {
  columns: string[];
  rows: string[][];
}

export function parseDump(text: string, dialect: DumpDialect, notes: TableNotes): { tables: Map<string, TableData>; relationships: PackageRelationship[]; ignored: number } {
  const sc: Scanner = { text, pos: 0, dialect, delimiter: ';' };
  const defs = new Map<string, TableDef>();
  const tables = new Map<string, TableData>();
  const relationships: PackageRelationship[] = [];
  const backslash = dialect === 'mysql';
  let ignored = 0;
  let totalRows = 0;
  const limit = rowLimit();

  const dataFor = (name: string, width: number): TableData => {
    let t = tables.get(name);
    if (!t) {
      if (tables.size >= READER_LIMITS.maxTables) throw new ReaderError('تعداد جدول‌های دامپ بیش از سقف مجاز است.');
      const def = defs.get(name);
      const columns = def?.columns ?? Array.from({ length: width }, (_v, k) => `col_${k + 1}`);
      t = { columns, rows: [] };
      tables.set(name, t);
    }
    return t;
  };
  const addRow = (name: string, columns: string[] | undefined, row: Array<string | typeof NULL>): void => {
    totalRows += 1;
    if (totalRows > limit) throw new ReaderError(`حداکثر ${limit} ردیف در هر بسته مجاز است.`);
    const t = dataFor(name, row.length);
    let targetCols = t.columns;
    if (columns && columns.length > 0) {
      // reorder to the table's column order, adding unseen columns at the end
      for (const c of columns) if (!targetCols.includes(c)) targetCols = [...targetCols, c];
      t.columns = targetCols;
    }
    const out: string[] = new Array(t.columns.length).fill('');
    row.forEach((v, idx) => {
      const colName = columns && columns.length > 0 ? columns[idx] : t.columns[idx];
      const at = colName === undefined ? -1 : t.columns.indexOf(colName);
      if (at >= 0) out[at] = v === NULL ? '' : v;
    });
    t.rows.push(out);
  };

  for (let stmt = nextStatement(sc); stmt !== null; stmt = nextStatement(sc)) {
    const s = stripLeading(stmt);
    if (!s) continue;
    if (/^CREATE\s/i.test(s)) {
      const def = parseCreateTable(s, relationships);
      if (def) defs.set(def.name, def);
      else ignored += 1;
      continue;
    }
    if (/^INSERT\s/i.test(s)) {
      const m = /^INSERT\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+)?(?:IGNORE\s+)?(?:INTO\s+)?/i.exec(s);
      const named = m ? readQualifiedName(s.slice(m[0].length)) : null;
      if (!named) { ignored += 1; continue; }
      let rest = named.rest.trimStart();
      let columns: string[] | undefined;
      if (rest.startsWith('(')) {
        const close = balancedParens(rest, 0);
        if (close === -1) { ignored += 1; continue; }
        columns = splitTopLevel(rest.slice(1, close)).map((c) => readQualifiedName(c)?.name ?? c.trim());
        rest = rest.slice(close + 1).trimStart();
      }
      rest = rest.replace(/^OVERRIDING\s+\w+\s+VALUE\s+/i, '');
      const v = /^VALUES?\b/i.exec(rest);
      if (!v) { ignored += 1; continue; } // INSERT ... SELECT / SET : never run
      parseTuples(rest, v[0].length, backslash, limit, (row) => addRow(named.name, columns, row));
      continue;
    }
    if (/^COPY\s/i.test(s) && dialect === 'postgres') {
      const m = /^COPY\s+/i.exec(s);
      const named = m ? readQualifiedName(s.slice(m[0].length)) : null;
      if (!named || !/\bFROM\s+stdin\b/i.test(named.rest)) { ignored += 1; continue; }
      const colsMatch = /^\s*\(([^)]*)\)/.exec(named.rest);
      const columns = colsMatch ? colsMatch[1].split(',').map((c) => readQualifiedName(c)?.name ?? c.trim()) : undefined;
      // data lines follow directly in the raw text, up to "\."
      let after = sc.pos;
      if (text[after] === '\r') after += 1;
      if (text[after] === '\n') after += 1;
      const end = text.indexOf('\n\\.', after - 1);
      const blockEnd = end === -1 ? text.length : end;
      const block = text.slice(after, blockEnd);
      let lineStart = 0;
      while (lineStart <= block.length) {
        let nl = block.indexOf('\n', lineStart);
        if (nl === -1) nl = block.length;
        const line = block.slice(lineStart, nl).replace(/\r$/, '');
        lineStart = nl + 1;
        if (line === '' && nl >= block.length) break;
        addRow(named.name, columns, line.split('\t').map(unescapeCopy));
      }
      const nextNl = end === -1 ? -1 : text.indexOf('\n', end + 3);
      sc.pos = end === -1 ? text.length : nextNl === -1 ? text.length : nextNl + 1;
      continue;
    }
    if (/^ALTER\s+TABLE\b/i.test(s)) {
      const m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?/i.exec(s);
      const named = m ? readQualifiedName(s.slice(m[0].length)) : null;
      const fk = named ? /FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(named.rest) : null;
      if (named && fk) {
        const from = readQualifiedName(fk[1].split(',')[0]);
        const toTable = readQualifiedName(fk[2]);
        const to = readQualifiedName(fk[3].split(',')[0]);
        if (from && toTable && to) relationships.push({ fromTable: named.name, fromColumn: from.name, toTable: toTable.name, toColumn: to.name, declared: true });
        continue;
      }
    }
    ignored += 1;
  }
  void notes;
  return { tables, relationships, ignored };
}

function makeReader(id: 'sql-mysql' | 'sql-postgres' | 'sql-mssql', dialect: DumpDialect, labelFa: string): FormatReader {
  return {
    id,
    labelFa,
    extensions: ['.sql', '.dump', '.txt'],
    detect(buffer) {
      let text: string;
      try {
        text = decodeText(buffer.subarray(0, 300_000)).text;
      } catch {
        return 0;
      }
      if (/\u0000/.test(text.slice(0, 4096))) return 0;
      if (!/\b(INSERT\s+INTO|CREATE\s+TABLE|COPY\s+\S+)/i.test(text)) return 0;
      return detectDumpDialect(text) === dialect ? 0.9 : 0;
    },
    read(buffer) {
      if (buffer.length > READER_LIMITS.maxTreeBytes * 2) {
        throw new ReaderError('حجم دامپ بیش از سقف مجاز است؛ جدول‌ها را جداگانه خروجی بگیرید.');
      }
      const decoded = decodeText(buffer);
      const notes = new TableNotes();
      const { tables, relationships, ignored } = parseDump(decoded.text, dialect, notes);
      const out: InMemoryTableReader[] = [];
      const used = new Set<string>();
      for (const [name, data] of tables) {
        const headers = cleanHeaders(data.columns, notes);
        const rows = data.rows.map((row) => headers.map((_h, i) => cleanCell(row[i] ?? '', notes)));
        let unique = sanitiseTableName(name);
        for (let n = 2; used.has(unique.toLowerCase()); n += 1) unique = `${sanitiseTableName(name)}_${n}`;
        used.add(unique.toLowerCase());
        out.push(new InMemoryTableReader(unique, headers, rows));
      }
      if (out.length === 0) {
        throw new ReaderError('این دامپ هیچ دستور INSERT/COPY با داده ندارد؛ دامپ را همراه با داده (data) خروجی بگیرید.');
      }
      const known = new Set(out.map((t) => t.name));
      const keep = relationships.filter((r) => known.has(r.fromTable) && known.has(r.toTable));
      return {
        tables: out,
        relationships: keep,
        formatId: id,
        notes: [
          ...decoded.notes,
          `دامپ فقط «خوانده» شد و هیچ دستوری اجرا نشد؛ ${ignored} دستور غیرداده (ساختار/مجوز/تابع/تنظیمات) نادیده گرفته شد.`,
          ...notes.toList(),
        ],
        close: () => undefined,
      };
    },
  };
}

export const mysqlDumpReader = makeReader('sql-mysql', 'mysql', 'دامپ MySQL/MariaDB (بدون اجرا)');
export const postgresDumpReader = makeReader('sql-postgres', 'postgres', 'دامپ PostgreSQL با COPY (بدون اجرا)');
export const mssqlScriptReader = makeReader('sql-mssql', 'mssql', 'اسکریپت T-SQL (بدون اجرا)');
