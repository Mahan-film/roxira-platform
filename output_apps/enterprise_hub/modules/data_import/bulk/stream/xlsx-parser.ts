import type { Readable } from 'stream';
import { MAX_CELL_CHARS, MAX_COLUMNS } from '../bulk.constants';
import { StringTable } from './string-table';
import {
  Cell,
  labelOf,
  dedupeColumns,
  emptyStats,
  ImportFileError,
  ParseEvent,
  ParseStats,
  statsNotes,
} from './types';
import { XmlHandler, XmlScanner } from './xml-scan';
import { ZipEntryHandler, ZipWalker } from './zip-walker';

const PIECE = 1024 * 1024;

interface SheetRef {
  name: string;
  rid: string;
  hidden: boolean;
  path?: string;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Utf-8 incremental text for XML parts. */
class XmlPart {
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  constructor(private readonly scanner: XmlScanner) {}
  data(chunk: Uint8Array): void {
    const text = this.decoder.decode(chunk, { stream: true });
    for (let at = 0; at < text.length; at += PIECE) this.scanner.write(text.slice(at, at + PIECE));
  }
  end(): void {
    const tail = this.decoder.decode();
    if (tail) this.scanner.write(tail);
  }
}

function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

export function serialToText(serial: number, date1904: boolean): string {
  if (!Number.isFinite(serial)) return String(serial);
  const days = Math.floor(serial);
  const fraction = serial - days;
  const seconds = Math.round(fraction * 86400);
  const time = seconds > 0 ? `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '';
  if (days <= 0) return time || '';
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const adjusted = !date1904 && days < 60 ? days + 1 : days; // Excel's 1900 leap-year bug
  const d = new Date(epoch + adjusted * 86_400_000);
  const iso = `${d.getUTCFullYear().toString().padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return time ? `${iso} ${time}` : iso;
}

/**
 * Streaming XLSX reader. Two passes over the (re-openable) source: the first collects the workbook map,
 * styles and shared strings (their position in the ZIP is not guaranteed to precede the sheets), the
 * second streams every visible sheet. Heap use is bounded by the shared-string spool, never by sheet size.
 */
export class XlsxStreamReader {
  readonly stats: ParseStats = emptyStats();
  private readonly sheets: SheetRef[] = [];
  private readonly rels = new Map<string, string>();
  private readonly strings = new StringTable();
  private readonly dateXfs: boolean[] = [];
  private readonly customDateFormats = new Set<number>();
  private date1904 = false;

  constructor(private readonly open: () => Promise<Readable>, private readonly prefix = '') {}

  close(): void {
    this.strings.close();
  }

  async *read(): AsyncGenerator<ParseEvent> {
    const sink: ParseEvent[] = [];
    for await (const _ of this.pass(
      (name) => {
        if (name === 'xl/workbook.xml') return this.workbookPart();
        if (name === 'xl/_rels/workbook.xml.rels') return this.relsPart();
        if (name === 'xl/styles.xml') return this.stylesPart();
        if (name === 'xl/sharedStrings.xml') return this.sharedStringsPart();
        return null;
      },
      sink,
    )) {
      /* the first pass only collects metadata */
    }
    if (this.sheets.length === 0) throw new ImportFileError('این فایل XLSX هیچ برگه‌ای ندارد یا خراب است.');
    for (const sheet of this.sheets) {
      const target = this.rels.get(sheet.rid);
      if (!target) continue;
      sheet.path = target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, '/');
    }
    const visible = this.sheets.filter((s) => !s.hidden && s.path);
    const hidden = this.sheets.filter((s) => s.hidden);
    if (hidden.length > 0) yield { kind: 'note', message: `${this.prefix || 'XLSX'}: ${hidden.length} برگهٔ پنهان خوانده نشد.` };
    const byPath = new Map(visible.map((s) => [s.path as string, s]));
    yield* this.pass((name) => {
      const sheet = byPath.get(name);
      return sheet ? this.sheetPart(sheet, sink) : null;
    }, sink);
    for (const message of statsNotes(this.stats, this.prefix || 'XLSX')) yield { kind: 'note', message };
  }

  /** One streaming pass over the ZIP; events that handlers put in `sink` are yielded as they appear. */
  private async *pass(pick: (name: string) => ZipEntryHandler | null, sink: ParseEvent[]): AsyncGenerator<ParseEvent> {
    const walker = new ZipWalker({ onEntry: pick, onNote: (message) => sink.push({ kind: 'note', message }) });
    const source = await this.open();
    try {
      for await (const chunk of source) {
        const bytes = chunk as Uint8Array;
        for (let at = 0; at < bytes.length; at += 64 * 1024) {
          walker.push(bytes.subarray(at, Math.min(at + 64 * 1024, bytes.length)));
          if (sink.length > 0) yield* sink.splice(0, sink.length);
        }
      }
      walker.finish();
      if (sink.length > 0) yield* sink.splice(0, sink.length);
    } finally {
      source.destroy();
    }
  }

  private workbookPart(): ZipEntryHandler {
    let current: SheetRef | null = null;
    const handler: XmlHandler = {
      open: (name, attrs) => {
        if (name === 'workbookPr' && (attrs.date1904 === '1' || attrs.date1904 === 'true')) this.date1904 = true;
        if (name === 'sheet') {
          current = { name: attrs.name ?? `Sheet${this.sheets.length + 1}`, rid: attrs.id ?? '', hidden: attrs.state === 'hidden' || attrs.state === 'veryHidden' };
          this.sheets.push(current);
        }
      },
      close: () => undefined,
      text: () => undefined,
    };
    return new XmlPart(new XmlScanner(handler, () => false));
  }

  private relsPart(): ZipEntryHandler {
    const handler: XmlHandler = {
      open: (name, attrs) => {
        if (name === 'Relationship' && attrs.Id && attrs.Target) this.rels.set(attrs.Id, attrs.Target);
      },
      close: () => undefined,
      text: () => undefined,
    };
    return new XmlPart(new XmlScanner(handler, () => false));
  }

  private stylesPart(): ZipEntryHandler {
    let inCellXfs = false;
    const handler: XmlHandler = {
      open: (name, attrs) => {
        if (name === 'numFmt') {
          const id = Number(attrs.numFmtId);
          const code = (attrs.formatCode ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
          if (/[ymdhs]/i.test(code) && !/general/i.test(code)) this.customDateFormats.add(id);
        } else if (name === 'cellXfs') inCellXfs = true;
        else if (name === 'xf' && inCellXfs) {
          const id = Number(attrs.numFmtId ?? 0);
          this.dateXfs.push(BUILTIN_DATE_FORMATS.has(id) || this.customDateFormats.has(id));
        }
      },
      close: (name) => {
        if (name === 'cellXfs') inCellXfs = false;
      },
      text: () => undefined,
    };
    return new XmlPart(new XmlScanner(handler, () => false));
  }

  private sharedStringsPart(): ZipEntryHandler {
    let inSi = false;
    let inPhonetic = false;
    let inT = false;
    let current = '';
    const handler: XmlHandler = {
      open: (name) => {
        if (name === 'si') {
          inSi = true;
          current = '';
        } else if (name === 'rPh') inPhonetic = true;
        else if (name === 't' && inSi && !inPhonetic) inT = true;
      },
      close: (name) => {
        if (name === 't') inT = false;
        else if (name === 'rPh') inPhonetic = false;
        else if (name === 'si') {
          inSi = false;
          this.strings.add(current.length > MAX_CELL_CHARS ? current.slice(0, MAX_CELL_CHARS) : current);
        }
      },
      text: (text) => {
        if (current.length < MAX_CELL_CHARS * 2) current += text;
      },
    };
    return new XmlPart(new XmlScanner(handler, () => inT));
  }

  private sheetPart(sheet: SheetRef, sink: ParseEvent[]): ZipEntryHandler {
    const table = labelOf(this.prefix ? `${this.prefix}/${sheet.name}` : sheet.name, `Sheet${this.sheets.indexOf(sheet) + 1}`);
    const stats = this.stats;
    let columns: string[] | null = null;
    let batch: Cell[][] = [];
    let row: string[] = [];
    let rowHasValue = false;
    let col = 0;
    let type = 'n';
    let style = -1;
    let text = '';
    let collecting = false;
    let inInline = false;
    let inPhonetic = false;

    const flush = (): void => {
      if (batch.length > 0) {
        sink.push({ kind: 'rows', table, rows: batch });
        batch = [];
      }
    };
    const handler: XmlHandler = {
      open: (name, attrs) => {
        switch (name) {
          case 'row':
            row = [];
            rowHasValue = false;
            col = 0;
            break;
          case 'c':
            col = attrs.r ? colIndex(attrs.r) : col;
            type = attrs.t ?? 'n';
            style = attrs.s !== undefined ? Number(attrs.s) : -1;
            text = '';
            break;
          case 'v':
            collecting = true;
            break;
          case 'is':
            inInline = true;
            break;
          case 'rPh':
            inPhonetic = true;
            break;
          case 't':
            if (inInline && !inPhonetic) collecting = true;
            break;
        }
      },
      close: (name) => {
        switch (name) {
          case 'v':
          case 't':
            collecting = false;
            break;
          case 'rPh':
            inPhonetic = false;
            break;
          case 'is':
            inInline = false;
            break;
          case 'c': {
            if (col >= 0 && col < MAX_COLUMNS) {
              let value: string;
              switch (type) {
                case 's':
                  value = this.strings.get(Number(text));
                  break;
                case 'b':
                  value = text === '1' ? 'TRUE' : 'FALSE';
                  break;
                case 'inlineStr':
                case 'str':
                case 'e':
                  value = text;
                  break;
                default:
                  value = style >= 0 && this.dateXfs[style] && text !== '' ? serialToText(Number(text), this.date1904) : text;
              }
              if (value.length > MAX_CELL_CHARS) {
                value = value.slice(0, MAX_CELL_CHARS);
                stats.truncatedCells += 1;
              }
              if (value !== '') {
                const c = value.charCodeAt(0);
                if ((c === 61 || c === 64) && type !== 'n') stats.formulaCells += 1;
                while (row.length < col) row.push('');
                row[col] = value;
                rowHasValue = true;
              }
            } else if (col >= MAX_COLUMNS) stats.droppedColumns += 1;
            col += 1;
            text = '';
            break;
          }
          case 'row': {
            if (rowHasValue) {
              if (!columns) {
                columns = dedupeColumns(row.map((cell) => cell ?? ''));
                sink.push({ kind: 'table', table, columns });
              } else {
                for (let k = 0; k < row.length; k += 1) if (row[k] === undefined) row[k] = '';
                batch.push(row);
                if (batch.length >= 5000) flush();
              }
            }
            row = [];
            break;
          }
        }
      },
      text: (value) => {
        if (text.length < MAX_CELL_CHARS * 2) text += value;
      },
    };
    const part = new XmlPart(new XmlScanner(handler, () => collecting));
    return {
      data: (chunk) => part.data(chunk),
      end: () => {
        part.end();
        flush();
      },
    };
  }
}

