import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_RECORD_CHARS } from '../bulk.constants';
import { PushTextDecoder } from './text-decoder';
import {
  Cell,
  dedupeColumns,
  emptyStats,
  ImportFileError,
  ParseEvent,
  ParseStats,
  PushParser,
  statsNotes,
} from './types';

const QUOTE = 34;
const CR = 13;
const LF = 10;
/** Rows per emitted event; also bounds memory when a hostile chunk inflates to millions of tiny rows. */
const ROWS_PER_EVENT = 20_000;

/**
 * Streaming CSV/TSV parser. Memory is bounded by one input chunk plus the unfinished record; a record
 * (a quoted field with embedded newlines can span many lines) larger than MAX_RECORD_CHARS is a hostile
 * or broken file and stops the import with a clear message instead of swallowing the rest of the file.
 */
export class CsvStreamParser implements PushParser {
  readonly stats: ParseStats = emptyStats();
  private readonly decoder = new PushTextDecoder();
  private carry = '';
  private delimiter = 0;
  private columns: string[] | null = null;
  private rowCount = 0;

  constructor(private readonly tableName: string, private readonly forcedDelimiter?: string) {}

  *push(chunk: Uint8Array): Generator<ParseEvent> {
    for (const text of this.decoder.push(chunk)) yield* this.consume(text, false);
  }

  *end(): Generator<ParseEvent> {
    const tail = this.decoder.end();
    if (tail.length === 0) yield* this.consume('', true);
    else {
      for (let index = 0; index < tail.length; index += 1) yield* this.consume(tail[index], index === tail.length - 1);
    }
    if (this.decoder.note) yield { kind: 'note', message: `${this.tableName}: ${this.decoder.note}` };
    for (const message of statsNotes(this.stats, this.tableName)) yield { kind: 'note', message };
  }

  private *consume(text: string, final: boolean): Generator<ParseEvent> {
    const buffer = this.carry + text;
    this.carry = '';
    if (!this.delimiter && buffer.length > 0) {
      this.delimiter = this.forcedDelimiter ? this.forcedDelimiter.charCodeAt(0) : sniffDelimiter(buffer);
    }
    let pos = 0;
    for (;;) {
      const rows: Cell[][] = [];
      pos = this.scan(buffer, pos, final, rows, ROWS_PER_EVENT);
      if (rows.length > 0 && !this.columns) {
        const header = rows.shift() as string[];
        this.columns = dedupeColumns(header.map((cell) => (cell ?? '').replace(/^\uFEFF/, '')));
        yield { kind: 'table', table: this.tableName, columns: this.columns };
      }
      if (rows.length > 0) {
        this.rowCount += rows.length;
        yield { kind: 'rows', table: this.tableName, rows };
      }
      if (!this.hitCap) break;
    }
    this.carry = buffer.slice(pos);
    if (this.carry.length > MAX_RECORD_CHARS) {
      throw new ImportFileError(
        'یک ردیف CSV بزرگ‌تر از حد مجاز است؛ احتمالاً گیومهٔ بسته‌نشده دارد. فایل را بررسی کنید.',
      );
    }
  }

  private hitCap = false;

  /** Scans complete records from `start`; returns the index of the first unconsumed char. */
  private scan(buf: string, start: number, final: boolean, out: Cell[][], maxRows: number): number {
    const n = buf.length;
    const delim = this.delimiter;
    this.hitCap = false;
    let i = start;
    let recordStart = start;
    let row: string[] = [];
    while (i < n) {
      let value: string;
      const first = buf.charCodeAt(i);
      if (first === QUOTE) {
        let j = i + 1;
        let segment = j;
        let acc = '';
        for (;;) {
          j = buf.indexOf('"', j);
          if (j === -1) {
            if (!final) return recordStart;
            acc += buf.slice(segment);
            i = n;
            value = acc;
            break;
          }
          if (j + 1 >= n && !final) return recordStart;
          if (buf.charCodeAt(j + 1) === QUOTE) {
            acc += buf.slice(segment, j + 1);
            j += 2;
            segment = j;
            continue;
          }
          acc += buf.slice(segment, j);
          i = j + 1;
          value = acc;
          break;
        }
        // Stray text between the closing quote and the delimiter is kept as part of the value.
        let c = i < n ? buf.charCodeAt(i) : -1;
        if (c !== -1 && c !== delim && c !== LF && c !== CR) {
          let k = i;
          while (k < n) {
            c = buf.charCodeAt(k);
            if (c === delim || c === LF || c === CR) break;
            k += 1;
          }
          value += buf.slice(i, k);
          i = k;
        }
      } else {
        let k = i;
        let c = first;
        while (k < n && c !== delim && c !== LF && c !== CR) {
          k += 1;
          c = k < n ? buf.charCodeAt(k) : -1;
        }
        value = buf.slice(i, k);
        i = k;
      }
      row.push(this.limitCell(value));
      if (i >= n) {
        if (!final) return recordStart;
        break;
      }
      const c = buf.charCodeAt(i);
      if (c === delim) {
        i += 1;
        if (i >= n) {
          if (!final) return recordStart;
          row.push('');
        }
        continue;
      }
      // Record end: \n, \r or \r\n.
      if (c === CR) {
        if (i + 1 >= n && !final) return recordStart;
        i += buf.charCodeAt(i + 1) === LF ? 2 : 1;
      } else {
        i += 1;
      }
      this.pushRow(row, out);
      row = [];
      recordStart = i;
      if (out.length >= maxRows) {
        this.hitCap = true;
        return i;
      }
    }
    if (row.length > 0) {
      this.pushRow(row, out);
      return n;
    }
    return final ? n : recordStart;
  }

  private limitCell(value: string): string {
    if (value.length > MAX_CELL_CHARS) {
      this.stats.truncatedCells += 1;
      return value.slice(0, MAX_CELL_CHARS);
    }
    const c = value.charCodeAt(0);
    if (c === 61 || c === 64) this.stats.formulaCells += 1;
    else if ((c === 43 || c === 45) && value.length > 1) {
      const d = value.charCodeAt(1);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 40 || d === 61 || d === 64) this.stats.formulaCells += 1;
    }
    return value;
  }

  private pushRow(row: string[], out: Cell[][]): void {
    if (row.length === 1 && row[0] === '') return; // blank line
    if (row.length > MAX_COLUMNS) {
      this.stats.droppedColumns += 1;
      row.length = MAX_COLUMNS;
    }
    if (this.columns && row.length !== this.columns.length) this.stats.raggedRows += 1;
    out.push(row);
  }
}

/** Picks `,` `;` tab or `|` by counting them (outside quotes) on the first few lines. */
export function sniffDelimiter(sample: string): number {
  const candidates = [44, 59, 9, 124];
  const counts = candidates.map(() => 0);
  let inQuote = false;
  let lines = 0;
  const limit = Math.min(sample.length, 16_384);
  for (let i = 0; i < limit && lines < 5; i += 1) {
    const c = sample.charCodeAt(i);
    if (c === QUOTE) inQuote = !inQuote;
    else if (!inQuote) {
      if (c === LF) lines += 1;
      else {
        const index = candidates.indexOf(c);
        if (index >= 0) counts[index] += 1;
      }
    }
  }
  let best = 0;
  for (let k = 1; k < candidates.length; k += 1) if (counts[k] > counts[best]) best = k;
  return counts[best] > 0 ? candidates[best] : 44;
}
