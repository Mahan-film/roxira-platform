import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_DDL_CHARS } from '../bulk.constants';
import { PushTextDecoder } from './text-decoder';
import {
  Cell,
  cleanTableName,
  dedupeColumns,
  emptyStats,
  ImportFileError,
  ParseEvent,
  ParseStats,
  PushParser,
  statsNotes,
} from './types';

/**
 * Streaming SQL dump reader for MySQL / MariaDB, PostgreSQL (INSERT and COPY ... FROM stdin) and T-SQL
 * scripts. It tokenises; it never executes anything. INSERT tuples and COPY lines are emitted as they are
 * read, so a single 2 GB INSERT statement costs the same memory as a 2 KB one.
 */
const LOOKAHEAD = 64;
const PIECE_CHARS = 1024 * 1024;

const enum S {
  Top,
  Word,
  Skip,
  Ddl,
  InsertHead,
  ValuesExpect,
  Value,
  Str,
  Raw,
  AfterValue,
  CopyHead,
  CopyData,
  SkipLine,
}

const enum Q {
  None,
  Single,
  Double,
  Backtick,
  LineComment,
  BlockComment,
  Dollar,
  Bracket,
}

interface TableInfo {
  columns: string[];
  announced: boolean;
}

export class SqlStreamParser implements PushParser {
  readonly stats: ParseStats = emptyStats();
  private readonly decoder = new PushTextDecoder();
  private readonly tables = new Map<string, TableInfo>();
  private readonly ddlColumns = new Map<string, string[]>();

  private state: S = S.Top;
  private quote: Q = Q.None;
  private dollarTag = '';
  private dollarProgress = '';
  private quotePrev = 0;
  private backslashEscapes: boolean | null = null;
  private pendingEscape = false;
  private word = '';
  private head = '';
  private depth = 0;

  // INSERT / VALUES
  private table = '';
  private columns: string[] = [];
  private tuple: Cell[] = [];
  private rows: Cell[][] = [];
  private cur = '';
  private curEscapes = false;
  private rawQuote = 0;
  private rawDepth = 0;
  private strQuoteSeen = false;
  private copyLine = '';
  private copyAwaitNewline = false;
  private events: ParseEvent[] = [];
  private pending = '';
  private limit = 0;
  private lineTail = '';

  constructor(private readonly fallbackTable = 'data') {}

  *push(chunk: Uint8Array): Generator<ParseEvent> {
    for (const text of this.decoder.push(chunk)) {
      for (let at = 0; at < text.length; at += PIECE_CHARS) {
        this.feed(text.slice(at, at + PIECE_CHARS), false);
        yield* this.flush();
      }
    }
  }

  *end(): Generator<ParseEvent> {
    const tail = this.decoder.end();
    if (tail.length === 0) this.feed('', true);
    else {
      for (let index = 0; index < tail.length; index += 1) {
        const text = tail[index];
        const last = index === tail.length - 1;
        for (let at = 0; at < text.length || (at === 0 && last); at += PIECE_CHARS) {
          const piece = text.slice(at, at + PIECE_CHARS);
          this.feed(piece, last && at + PIECE_CHARS >= text.length);
          yield* this.flush();
          if (text.length === 0) break;
        }
      }
    }
    if (this.state === S.Value || this.state === S.Str || this.state === S.Raw || this.state === S.AfterValue) {
      this.events.push({ kind: 'note', message: 'فایل SQL در میانهٔ یک دستور INSERT قطع شده است؛ ردیف ناقص نادیده گرفته شد.' });
    }
    if (this.copyLine.length > 0) this.finishCopyLine(this.copyLine);
    yield* this.flush();
    if (this.decoder.note) yield { kind: 'note', message: `${this.fallbackTable}: ${this.decoder.note}` };
    for (const message of statsNotes(this.stats, this.fallbackTable)) yield { kind: 'note', message };
  }

  /** Runs the lexer on pending + text, keeping the last LOOKAHEAD chars back so two-char tokens never split. */
  private feed(text: string, final: boolean): void {
    const all = this.pending + text;
    this.pending = '';
    this.limit = final ? all.length : Math.max(0, all.length - LOOKAHEAD);
    const used = this.run(all);
    this.pending = used < all.length ? all.slice(used) : '';
  }

  private flush(): ParseEvent[] {
    if (this.rows.length > 0) {
      this.events.push({ kind: 'rows', table: this.table, rows: this.rows });
      this.rows = [];
    }
    const out = this.events;
    this.events = [];
    return out;
  }

  private emitRows(): void {
    if (this.rows.length > 0) {
      this.events.push({ kind: 'rows', table: this.table, rows: this.rows });
      this.rows = [];
    }
  }

  // ---------------------------------------------------------------- main loop

  private run(text: string): number {
    if (this.backslashEscapes === null) {
      // MySQL treats \' as an escape; PostgreSQL (standard_conforming_strings) and T-SQL do not.
      const sample = text.slice(0, 65_536);
      const mysql = /MySQL dump|mysqldump|MariaDB|ENGINE\s*=|`[^`\n]+`/i.test(sample);
      const other = /PostgreSQL database dump|\bFROM\s+stdin\b|SET\s+ANSI_NULLS|^\s*GO\s*$|\[dbo\]/im.test(sample);
      this.backslashEscapes = mysql || !other;
    }
    const n = text.length;
    const limit = this.limit;
    let i = 0;
    while (i < limit) {
      switch (this.state) {
        case S.Top: {
          const c = text.charCodeAt(i);
          if (this.quote === Q.LineComment) {
            const j = text.indexOf('\n', i);
            if (j === -1) return n;
            i = j + 1;
            this.quote = Q.None;
            continue;
          }
          if (this.quote === Q.BlockComment) {
            const j = text.indexOf('*/', i);
            if (j === -1) return Math.max(i, n - 1);
            i = j + 2;
            this.quote = Q.None;
            continue;
          }
          if (c <= 32 || c === 59 || c === 0xfeff) {
            i += 1;
            continue;
          }
          if (c === 45 && text.charCodeAt(i + 1) === 45) {
            this.quote = Q.LineComment;
            i += 2;
            continue;
          }
          if (c === 35) {
            this.quote = Q.LineComment;
            i += 1;
            continue;
          }
          if (c === 47 && text.charCodeAt(i + 1) === 42) {
            this.quote = Q.BlockComment;
            i += 2;
            continue;
          }
          this.word = '';
          this.state = S.Word;
          continue;
        }
        case S.Word: {
          const c = text.charCodeAt(i);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) {
            this.word += text[i];
            i += 1;
            if (this.word.length > 32) {
              this.beginSkip();
            }
            continue;
          }
          this.decideStatement(this.word.toUpperCase());
          // do not consume the delimiter char: the next state sees it
          continue;
        }
        case S.SkipLine: {
          const j = text.indexOf('\n', i);
          if (j === -1) return n;
          i = j + 1;
          this.state = S.Top;
          continue;
        }
        case S.Skip:
        case S.Ddl:
        case S.InsertHead:
        case S.CopyHead: {
          i = this.lexStatement(text, i);
          continue;
        }
        case S.ValuesExpect: {
          const c = text.charCodeAt(i);
          if (c <= 32) {
            i += 1;
            continue;
          }
          if (c === 40) {
            this.tuple = [];
            this.state = S.Value;
            i += 1;
            continue;
          }
          if (c === 44) {
            i += 1;
            continue;
          }
          if (c === 59) {
            this.emitRows();
            this.state = S.Top;
            i += 1;
            continue;
          }
          // End of the statement without `;` (T-SQL ends with GO) or a trailing clause such as
          // ON DUPLICATE KEY / ON CONFLICT: the Top state decides what follows.
          this.emitRows();
          this.state = S.Top;
          continue;
        }
        case S.Value: {
          const c = text.charCodeAt(i);
          if (c <= 32) {
            i += 1;
            continue;
          }
          if (c === 39) {
            this.cur = '';
            this.curEscapes = this.backslashEscapes === true;
            this.strQuoteSeen = false;
            this.state = S.Str;
            i += 1;
            continue;
          }
          this.cur = '';
          this.rawQuote = 0;
          this.rawDepth = 0;
          this.state = S.Raw;
          continue;
        }
        case S.Str: {
          i = this.readString(text, i);
          continue;
        }
        case S.Raw: {
          i = this.readRaw(text, i);
          continue;
        }
        case S.AfterValue: {
          const c = text.charCodeAt(i);
          if (c <= 32) {
            i += 1;
            continue;
          }
          if (c === 44) {
            this.state = S.Value;
            i += 1;
            continue;
          }
          if (c === 41) {
            this.finishTuple();
            this.state = S.ValuesExpect;
            i += 1;
            continue;
          }
          // Garbage between values: treat as part of the stream, skip a char to guarantee progress.
          i += 1;
          continue;
        }
        case S.CopyData: {
          i = this.readCopy(text, i);
          continue;
        }
      }
    }
    return Math.min(i, n);
  }

  // ------------------------------------------------------------ statements

  private beginSkip(): void {
    this.state = S.Skip;
    this.quote = Q.None;
    this.depth = 0;
    this.head = '';
    this.lineTail = '';
  }

  private decideStatement(word: string): void {
    this.head = '';
    this.depth = 0;
    this.quote = Q.None;
    this.lineTail = '';
    switch (word) {
      case 'INSERT':
      case 'REPLACE':
        this.state = S.InsertHead;
        return;
      case 'COPY':
        this.state = S.CopyHead;
        return;
      case 'CREATE':
        this.state = S.Ddl;
        return;
      case 'GO':
        this.state = S.SkipLine;
        return;
      default:
        this.stats.skippedStatements += 1;
        this.state = S.Skip;
    }
  }

  /**
   * Consumes characters of a non-streamed statement (head of INSERT, CREATE TABLE, COPY head, anything
   * skipped) honouring quotes and comments, until the statement ends. Returns the next index.
   */
  private lexStatement(text: string, start: number): number {
    const limit = this.limit;
    let i = start;
    const keep = this.state !== S.Skip;
    while (i < limit) {
      const c = text.charCodeAt(i);
      if (this.quote === Q.None) {
        if (c === 10) {
          if (/^\s*GO\s*$/i.test(this.lineTail) && this.depth === 0) {
            this.endStatement();
            return i + 1;
          }
          this.lineTail = '';
        } else if (this.lineTail.length < 8) this.lineTail += text[i];
      }
      switch (this.quote) {
        case Q.None: {
          if (c === 39) this.quote = Q.Single;
          else if (c === 34) this.quote = Q.Double;
          else if (c === 96) this.quote = Q.Backtick;
          else if (c === 91 && this.state !== S.Skip) this.quote = Q.Bracket;
          else if (c === 45 && text.charCodeAt(i + 1) === 45) {
            this.quote = Q.LineComment;
            i += 1;
          } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
            this.quote = Q.BlockComment;
            i += 1;
          } else if (c === 36) {
            const m = /^\$([A-Za-z_]*)\$/.exec(text.slice(i, i + 40));
            if (m) {
              this.quote = Q.Dollar;
              this.dollarTag = m[0];
              this.dollarProgress = '';
              if (keep) this.head += m[0];
              i += m[0].length;
              continue;
            }
          } else if (c === 40) this.depth += 1;
          else if (c === 41) this.depth = Math.max(0, this.depth - 1);
          else if (c === 59 && this.depth === 0) {
            this.endStatement();
            return i + 1;
          } else if ((c === 86 || c === 118) && this.state === S.InsertHead && this.depth === 0) {
            const length = this.valuesKeywordLength(text, i);
            if (length > 0) {
              this.head += text.slice(i, i + length);
              this.startValues();
              return i + length;
            }
          }
          break;
        }
        case Q.Single:
          if (c === 92 && this.backslashEscapes) {
            if (keep) this.head += text[i];
            i += 1;
          } else if (c === 39) {
            if (text.charCodeAt(i + 1) === 39) {
              if (keep) this.head += text[i];
              i += 1;
            } else this.quote = Q.None;
          }
          break;
        case Q.Double:
          if (c === 34) this.quote = Q.None;
          break;
        case Q.Backtick:
          if (c === 96) this.quote = Q.None;
          break;
        case Q.Bracket:
          if (c === 93) this.quote = Q.None;
          break;
        case Q.LineComment:
          if (c === 10) this.quote = Q.None;
          break;
        case Q.BlockComment:
          if (c === 42 && text.charCodeAt(i + 1) === 47) {
            this.quote = Q.None;
            i += 1;
          }
          break;
        case Q.Dollar: {
          if (text.startsWith(this.dollarTag, i)) {
            this.quote = Q.None;
            if (keep) this.head += this.dollarTag;
            i += this.dollarTag.length;
            continue;
          }
          break;
        }
      }
      if (keep && this.quote !== Q.LineComment && this.quote !== Q.BlockComment) {
        if (this.head.length < MAX_DDL_CHARS) this.head += text[i];
        else if (this.state === S.InsertHead && this.head.length === MAX_DDL_CHARS) {
          throw new ImportFileError('سربرگ یک دستور INSERT بیش از حد طولانی است.');
        }
      }
      i += 1;
    }
    return i;
  }

  /** Length of a VALUES / VALUE keyword starting at `i` (0 when it is not one, e.g. inside an identifier). */
  private valuesKeywordLength(text: string, i: number): number {
    const prev = this.head.length > 0 ? this.head.charCodeAt(this.head.length - 1) : 32;
    if ((prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122) || prev === 95) return 0;
    const m = /^values?(?![A-Za-z0-9_])/i.exec(text.slice(i, i + 8));
    return m ? m[0].length : 0;
  }

  private endStatement(): void {
    const head = this.head;
    const state = this.state;
    this.head = '';
    this.quote = Q.None;
    this.depth = 0;
    this.state = S.Top;
    if (state === S.Ddl) this.readCreateTable(head);
    else if (state === S.CopyHead) this.startCopy(head);
    else if (state === S.InsertHead) {
      // INSERT ... SELECT or a header with no VALUES: nothing to stream.
      this.stats.skippedStatements += 1;
    }
  }

  private readCreateTable(text: string): void {
    const m = /^\s*(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[`"\[][^`"\]]+[`"\]]|[\w$]+)(?:\s*\.\s*(?:[`"\[][^`"\]]+[`"\]]|[\w$]+))*)\s*\(([\s\S]*)\)[^)]*$/i.exec(
      text,
    );
    if (!m) {
      this.stats.skippedStatements += 1;
      return;
    }
    const name = cleanTableName(m[1], this.fallbackTable);
    const columns: string[] = [];
    for (const def of splitTopLevel(m[2])) {
      const first = /^\s*(?:[`"\[]([^`"\]]+)[`"\]]|([^\s(]+))/.exec(def);
      if (!first) continue;
      const token = (first[1] ?? first[2] ?? '').trim();
      if (/^(PRIMARY|KEY|UNIQUE|CONSTRAINT|FOREIGN|INDEX|CHECK|FULLTEXT|SPATIAL|EXCLUDE|LIKE|PERIOD)$/i.test(token) && !first[1]) continue;
      columns.push(token);
    }
    if (columns.length > 0) this.ddlColumns.set(name, columns.slice(0, MAX_COLUMNS));
  }

  // ----------------------------------------------------------------- INSERT

  private startValues(): void {
    const m = /^\s*(?:IGNORE\s+|LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+)*(?:INTO\s+)?((?:[`"\[][^`"\]]+[`"\]]|[\w$]+)(?:\s*\.\s*(?:[`"\[][^`"\]]+[`"\]]|[\w$]+))*)\s*(?:\(([\s\S]*)\))?\s*$/i.exec(
      this.head.replace(/\s*VALUES?\s*$/i, '').replace(/^\s*/, ''),
    );
    this.head = '';
    this.quote = Q.None;
    this.depth = 0;
    if (!m) {
      this.stats.skippedStatements += 1;
      this.state = S.Skip;
      return;
    }
    this.emitRows();
    this.table = cleanTableName(m[1], this.fallbackTable);
    const listed = m[2] !== undefined ? splitTopLevel(m[2]).map((c) => c.trim().replace(/^[`"[]+|[`"\]]+$/g, '')) : null;
    this.columns = listed ?? this.ddlColumns.get(this.table) ?? [];
    this.state = S.ValuesExpect;
  }

  private readString(text: string, start: number): number {
    const n = text.length;
    let i = start;
    let from = i;
    while (i < n) {
      if (this.pendingEscape) {
        this.cur += unescapeChar(text[i]);
        this.pendingEscape = false;
        i += 1;
        from = i;
        continue;
      }
      if (this.strQuoteSeen) {
        // The previous chunk ended right after a quote: decide between '' and end of string.
        this.strQuoteSeen = false;
        if (text.charCodeAt(i) === 39) {
          this.cur += "'";
          i += 1;
          from = i;
          continue;
        }
        this.endString();
        return i;
      }
      let j = i;
      const stopAtBackslash = this.curEscapes;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 39 || (stopAtBackslash && c === 92)) break;
        j += 1;
      }
      this.cur += text.slice(from, j);
      if (this.cur.length > MAX_CELL_CHARS * 4) this.capCell();
      if (j >= n) return n;
      if (text.charCodeAt(j) === 92) {
        if (j + 1 >= n) {
          this.pendingEscape = true;
          return n;
        }
        this.cur += unescapeChar(text[j + 1]);
        i = j + 2;
        from = i;
        continue;
      }
      // a quote
      if (j + 1 >= n) {
        this.strQuoteSeen = true;
        return n;
      }
      if (text.charCodeAt(j + 1) === 39) {
        this.cur += "'";
        i = j + 2;
        from = i;
        continue;
      }
      this.endString();
      return j + 1;
    }
    return n;
  }

  private capCell(): void {
    if (this.cur.length > MAX_CELL_CHARS) {
      this.cur = this.cur.slice(0, MAX_CELL_CHARS);
      this.stats.truncatedCells += 1;
    }
  }

  private endString(): void {
    this.capCell();
    this.tuple.push(this.cur);
    this.cur = '';
    this.state = S.AfterValue;
  }

  private readRaw(text: string, start: number): number {
    const n = text.length;
    let i = start;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (this.rawQuote) {
        this.cur += text[i];
        if (c === this.rawQuote) this.rawQuote = 0;
        i += 1;
        continue;
      }
      if (c === 39 || c === 34) {
        // A prefix such as N'..', E'..', _utf8mb4'..' or X'..' before the quote.
        if (this.rawDepth === 0 && /^(?:[NnEe]|_[A-Za-z0-9]{1,12})$/.test(this.cur.trim())) {
          this.curEscapes = /^[Ee]$/.test(this.cur.trim()) || this.backslashEscapes === true;
          this.cur = '';
          this.strQuoteSeen = false;
          this.state = S.Str;
          return i + 1;
        }
        this.rawQuote = c;
        this.cur += text[i];
        i += 1;
        continue;
      }
      if (c === 40) this.rawDepth += 1;
      else if (c === 41) {
        if (this.rawDepth === 0) {
          this.endRaw();
          return i;
        }
        this.rawDepth -= 1;
      } else if (c === 44 && this.rawDepth === 0) {
        this.endRaw();
        return i;
      }
      this.cur += text[i];
      i += 1;
      if (this.cur.length > MAX_CELL_CHARS * 4) this.capCell();
    }
    return n;
  }

  private endRaw(): void {
    const raw = this.cur.trim();
    this.cur = '';
    this.tuple.push(/^null$/i.test(raw) ? null : raw.slice(0, MAX_CELL_CHARS));
    this.state = S.AfterValue;
  }

  private finishTuple(): void {
    if (this.tuple.length > MAX_COLUMNS) {
      this.stats.droppedColumns += 1;
      this.tuple.length = MAX_COLUMNS;
    }
    this.announce(this.table, this.columns, this.tuple.length);
    this.rows.push(this.tuple);
    this.tuple = [];
    if (this.rows.length >= 2000) this.emitRows();
  }

  private announce(table: string, columns: string[], width: number): void {
    let info = this.tables.get(table);
    if (!info) {
      const cols = columns.length > 0 ? columns : Array.from({ length: width }, (_, k) => `column_${k + 1}`);
      info = { columns: dedupeColumns(cols), announced: false };
      this.tables.set(table, info);
    }
    if (!info.announced) {
      info.announced = true;
      this.events.push({ kind: 'table', table, columns: info.columns });
    }
  }

  // ------------------------------------------------------------------- COPY

  private startCopy(head: string): void {
    const m = /^\s*((?:[`"\[][^`"\]]+[`"\]]|[\w$]+)(?:\s*\.\s*(?:[`"\[][^`"\]]+[`"\]]|[\w$]+))*)\s*(?:\(([^)]*)\))?\s*FROM\s+stdin\b/i.exec(head);
    if (!m) {
      this.stats.skippedStatements += 1;
      return;
    }
    this.emitRows();
    this.table = cleanTableName(m[1], this.fallbackTable);
    this.columns = m[2] ? m[2].split(',').map((c) => c.trim().replace(/^[`"[]+|[`"\]]+$/g, '')) : this.ddlColumns.get(this.table) ?? [];
    this.copyLine = '';
    this.copyAwaitNewline = true;
    this.state = S.CopyData;
  }

  private readCopy(text: string, start: number): number {
    const n = text.length;
    let i = start;
    if (this.copyAwaitNewline) {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return n;
      this.copyAwaitNewline = false;
      i = eol + 1;
    }
    while (i < n) {
      const j = text.indexOf('\n', i);
      if (j === -1) {
        this.copyLine += text.slice(i);
        if (this.copyLine.length > MAX_CELL_CHARS * MAX_COLUMNS) {
          throw new ImportFileError('یک ردیف COPY بیش از حد بزرگ است.');
        }
        return n;
      }
      const line = (this.copyLine + text.slice(i, j)).replace(/\r$/, '');
      this.copyLine = '';
      i = j + 1;
      if (line === '\\.') {
        this.emitRows();
        this.state = S.Top;
        return i;
      }
      this.finishCopyLine(line);
    }
    return n;
  }

  private finishCopyLine(line: string): void {
    if (line === '' && this.state !== S.CopyData) return;
    const cells: Cell[] = [];
    for (const raw of line.split('\t')) {
      if (raw === '\\N') cells.push(null);
      else {
        let value = raw.indexOf('\\') === -1 ? raw : raw.replace(/\\(.)/g, (_m, ch: string) => unescapeChar(ch));
        if (value.length > MAX_CELL_CHARS) {
          value = value.slice(0, MAX_CELL_CHARS);
          this.stats.truncatedCells += 1;
        }
        cells.push(value);
      }
    }
    if (cells.length > MAX_COLUMNS) {
      this.stats.droppedColumns += 1;
      cells.length = MAX_COLUMNS;
    }
    this.announce(this.table, this.columns, cells.length);
    this.rows.push(cells);
    this.copyLine = '';
    if (this.rows.length >= 2000) this.emitRows();
  }
}

function unescapeChar(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '0':
      return '\0';
    case 'b':
      return '\b';
    case 'Z':
      return '\x1a';
    default:
      return ch;
  }
}

/** Splits on commas that are not inside parentheses or quotes. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}
