/**
 * خواندن اکسل قدیمی XLS (BIFF8 داخل کانتینر OLE2) بدون هیچ کتابخانهٔ خارجی.
 *
 * پشتیبانی: رشته‌های اشتراکی (با CONTINUE)، عدد، RK/MULRK، LABEL، نتیجهٔ ذخیره‌شدهٔ فرمول، بولی،
 * تاریخ (از روی قالب سلول). رمزدار، BIFF5 و ماکرو پشتیبانی نمی‌شوند و با پیام فارسی رد می‌شوند.
 */

import { isCfb, readCfbStream } from './cfb';
import { READER_LIMITS, rowLimit } from './limits';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, TableNotes, uniqueTableName } from './tabular';
import { packageOf } from './text-formats.reader';

const BAD = 'فایل اکسل قدیمی (XLS) معتبر نیست یا آسیب‌دیده است.';

interface Rec { id: number; data: Buffer }

function* records(stream: Buffer, start: number): Generator<Rec> {
  let pos = start;
  let count = 0;
  while (pos + 4 <= stream.length) {
    const id = stream.readUInt16LE(pos);
    const len = stream.readUInt16LE(pos + 2);
    if (pos + 4 + len > stream.length) return;
    count += 1;
    if (count > 5_000_000) throw new ReaderError('تعداد رکوردهای فایل XLS بیش از سقف مجاز است.');
    yield { id, data: stream.subarray(pos + 4, pos + 4 + len) };
    pos += 4 + len;
  }
}

class Chunks {
  private ci = 0;
  private pos = 0;
  constructor(private readonly chunks: Buffer[]) {}
  private cur(): Buffer | undefined {
    while (this.ci < this.chunks.length && this.pos >= this.chunks[this.ci].length) {
      this.ci += 1;
      this.pos = 0;
    }
    return this.chunks[this.ci];
  }
  get done(): boolean {
    return this.cur() === undefined;
  }
  u8(): number {
    const c = this.cur();
    if (!c) throw new ReaderError(BAD);
    return c[this.pos++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number): void {
    let left = n;
    while (left > 0) {
      const c = this.cur();
      if (!c) return;
      const take = Math.min(left, c.length - this.pos);
      this.pos += take;
      left -= take;
    }
  }
  chars(count: number, wide: boolean): string {
    let out = '';
    let left = count;
    let isWide = wide;
    while (left > 0) {
      let c = this.cur();
      if (!c) throw new ReaderError(BAD);
      const fresh = this.pos === 0 && this.ci > 0;
      if (fresh) {
        // continuation chunk in the middle of a string starts with its own flags byte
        isWide = (c[this.pos++] & 1) === 1;
        c = this.cur();
        if (!c) throw new ReaderError(BAD);
      }
      const unit = isWide ? 2 : 1;
      const fit = Math.max(1, Math.floor((c.length - this.pos) / unit));
      const take = Math.min(left, fit);
      const bytes = c.subarray(this.pos, this.pos + take * unit);
      out += isWide ? bytes.toString('utf16le') : bytes.toString('latin1');
      this.pos += take * unit;
      left -= take;
    }
    return out;
  }
}

function parseSst(first: Buffer, continues: Buffer[]): string[] {
  const unique = first.readUInt32LE(4);
  if (unique > 4_000_000) throw new ReaderError(BAD);
  const reader = new Chunks([first.subarray(8), ...continues]);
  const out: string[] = [];
  for (let i = 0; i < unique && !reader.done; i += 1) {
    const cch = reader.u16();
    const flags = reader.u8();
    const rich = flags & 8 ? reader.u16() : 0;
    const ext = flags & 4 ? reader.u32() : 0;
    out.push(reader.chars(cch, (flags & 1) === 1));
    reader.skip(rich * 4 + ext);
  }
  return out;
}

function decodeRk(rk: number): number {
  let value: number;
  if (rk & 2) {
    value = (rk | 0) >> 2;
  } else {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = buf.readDoubleLE(0);
  }
  return rk & 1 ? value / 100 : value;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatString(format: string): boolean {
  const stripped = format.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '');
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(format.trim());
}

function serialToText(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const days = Math.floor(serial);
  const seconds = Math.round((serial - days) * 86400);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days >= 61 ? 30 : 31);
  const date = new Date(base + days * 86_400_000 + seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return seconds === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
}

export const xlsReader: FormatReader = {
  id: 'xls',
  labelFa: 'اکسل قدیمی (XLS)',
  extensions: ['.xls'],
  detect(buffer) {
    if (!isCfb(buffer)) return 0;
    // Other OLE2 containers (Access? no, DOC/PPT/MSI) are rejected in read(); score is high only
    // when a Workbook/Book stream exists.
    try {
      return readCfbStream(buffer, ['Workbook', 'Book']) ? 0.95 : 0;
    } catch {
      return 0.1;
    }
  },
  read(buffer) {
    const stream = readCfbStream(buffer, ['Workbook', 'Book']);
    if (!stream) throw new ReaderError('این فایل OLE2 یک کارپوشهٔ اکسل نیست.');

    const sheets: Array<{ name: string; offset: number }> = [];
    const formats = new Map<number, string>();
    const xfFormat: number[] = [];
    let sst: string[] = [];
    let date1904 = false;
    let skippedSheets = 0;

    let pendingSst: Buffer | null = null;
    let continues: Buffer[] = [];
    const flushSst = (): void => {
      if (pendingSst) {
        sst = parseSst(pendingSst, continues);
        pendingSst = null;
        continues = [];
      }
    };
    let first = true;
    let depth = 0;
    for (const rec of records(stream, 0)) {
      if (rec.id === 0x809) {
        if (first) {
          if (rec.data.readUInt16LE(0) !== 0x0600) {
            throw new ReaderError('نسخهٔ این فایل XLS قدیمی‌تر از Excel 97 است؛ آن را به XLSX ذخیره کنید.');
          }
          first = false;
        }
        depth += 1;
        continue;
      }
      if (rec.id === 0x0a) {
        flushSst();
        depth -= 1;
        if (depth <= 0) break;
        continue;
      }
      if (rec.id === 0x3c && pendingSst) {
        continues.push(rec.data);
        continue;
      }
      if (pendingSst) flushSst();
      switch (rec.id) {
        case 0x2f:
          throw new ReaderError('این فایل XLS رمزدار است؛ رمز را بردارید و دوباره بفرستید.');
        case 0x22:
          date1904 = rec.data.readUInt16LE(0) === 1;
          break;
        case 0x85: {
          const offset = rec.data.readUInt32LE(0);
          const state = rec.data[4] & 3;
          const type = rec.data[5];
          const cch = rec.data[6];
          const wide = (rec.data[7] & 1) === 1;
          const name = wide
            ? rec.data.subarray(8, 8 + cch * 2).toString('utf16le')
            : rec.data.subarray(8, 8 + cch).toString('latin1');
          if (type === 0 && state === 0) sheets.push({ name, offset });
          else skippedSheets += 1;
          break;
        }
        case 0x41: {
          const index = rec.data.readUInt16LE(0);
          const cch = rec.data.readUInt16LE(2);
          const wide = (rec.data[4] & 1) === 1;
          formats.set(
            index,
            wide
              ? rec.data.subarray(5, 5 + cch * 2).toString('utf16le')
              : rec.data.subarray(5, 5 + cch).toString('latin1'),
          );
          break;
        }
        case 0xe0:
          xfFormat.push(rec.data.readUInt16LE(2));
          break;
        case 0xfc:
          pendingSst = rec.data;
          continues = [];
          break;
        default:
          break;
      }
    }
    flushSst();

    if (sheets.length === 0) throw new ReaderError('هیچ برگهٔ قابل خواندنی در فایل XLS نیست.');
    if (sheets.length > READER_LIMITS.maxSheetsPerWorkbook) {
      throw new ReaderError('تعداد برگه‌های فایل بیش از سقف مجاز است.');
    }

    const isDateXf = (xf: number): boolean => {
      const fmt = xfFormat[xf];
      if (fmt === undefined) return false;
      if (BUILTIN_DATE.has(fmt)) return true;
      const custom = formats.get(fmt);
      return custom !== undefined && isDateFormatString(custom);
    };

    const notes = new TableNotes();
    const used = new Set<string>();
    const tables = sheets.map((sheet) => {
      const grid = new Map<number, string[]>();
      let cells = 0;
      const put = (row: number, col: number, value: string): void => {
        if (row > 65_535 || col > 255) return;
        cells += 1;
        if (cells > READER_LIMITS.maxCells) throw new ReaderError('تعداد سلول‌های برگه بیش از سقف مجاز است.');
        let line = grid.get(row);
        if (!line) {
          if (grid.size > rowLimit() + 100) throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
          line = [];
          grid.set(row, line);
        }
        while (line.length <= col) line.push('');
        line[col] = value;
      };
      const num = (xf: number, v: number): string =>
        (isDateXf(xf) ? serialToText(v, date1904) : null) ?? numberText(v);

      let lastFormula: { row: number; col: number } | null = null;
      let level = 0;
      for (const rec of records(stream, sheet.offset)) {
        const d = rec.data;
        if (rec.id === 0x809) { level += 1; continue; }
        if (rec.id === 0x0a) { level -= 1; if (level <= 0) break; continue; }
        switch (rec.id) {
          case 0xfd: // LABELSST
            put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
            break;
          case 0x203: // NUMBER
            put(d.readUInt16LE(0), d.readUInt16LE(2), num(d.readUInt16LE(4), d.readDoubleLE(6)));
            break;
          case 0x27e: // RK
            put(d.readUInt16LE(0), d.readUInt16LE(2), num(d.readUInt16LE(4), decodeRk(d.readUInt32LE(6))));
            break;
          case 0xbd: { // MULRK
            const row = d.readUInt16LE(0);
            const first2 = d.readUInt16LE(2);
            const count = (d.length - 6) / 6;
            for (let i = 0; i < count; i += 1) {
              put(row, first2 + i, num(d.readUInt16LE(4 + i * 6), decodeRk(d.readUInt32LE(6 + i * 6))));
            }
            break;
          }
          case 0x204: { // LABEL
            const cch = d.readUInt16LE(6);
            const wide = (d[8] & 1) === 1;
            put(
              d.readUInt16LE(0),
              d.readUInt16LE(2),
              wide ? d.subarray(9, 9 + cch * 2).toString('utf16le') : d.subarray(9, 9 + cch).toString('latin1'),
            );
            break;
          }
          case 0x205: // BOOLERR
            if (d[7] === 0) put(d.readUInt16LE(0), d.readUInt16LE(2), d[6] ? 'true' : 'false');
            break;
          case 0x06: { // FORMULA (cached result)
            const row = d.readUInt16LE(0);
            const col = d.readUInt16LE(2);
            if (d.readUInt16LE(12) === 0xffff) {
              if (d[6] === 0) lastFormula = { row, col };
              else if (d[6] === 1) put(row, col, d[8] ? 'true' : 'false');
            } else {
              put(row, col, num(d.readUInt16LE(4), d.readDoubleLE(6)));
            }
            break;
          }
          case 0x207: // STRING (result of the previous formula)
            if (lastFormula && d.length >= 3) {
              const cch = d.readUInt16LE(0);
              const wide = (d[2] & 1) === 1;
              put(
                lastFormula.row,
                lastFormula.col,
                wide ? d.subarray(3, 3 + cch * 2).toString('utf16le') : d.subarray(3, 3 + cch).toString('latin1'),
              );
              lastFormula = null;
            }
            break;
          default:
            break;
        }
      }
      const rows = [...grid.keys()].sort((a, b) => a - b).map((r) => grid.get(r) ?? []);
      return buildTable(uniqueTableName(sheet.name, used), rows, notes, { autoHeader: true });
    });
    const extra = skippedSheets > 0 ? [`${skippedSheets} برگهٔ پنهان/نمودار نادیده گرفته شد.`] : [];
    return packageOf('xls', tables, notes, extra);
  },
};
