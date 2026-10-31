/**
 * خواندن DBF (dBase III/IV، FoxPro، Clipper) — قالب بسیاری از نرم‌افزارهای حسابداری قدیمی ایران.
 *
 * هدر خصمانه (تعداد رکورد دروغ، طول رکورد ناسازگار، فیلد بیش از حد) رد یا به اندازهٔ واقعی فایل
 * کوتاه می‌شود. فایل memo (.dbt/.fpt) خوانده نمی‌شود؛ ستون‌های M خالی می‌مانند.
 */

import { rowLimit, READER_LIMITS } from './limits';
import { arabicShareOfHighBytes, IRAN_SYSTEM_MESSAGE } from './persian/text-decode';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, TableNotes } from './tabular';
import { packageOf } from './text-formats.reader';

const VERSIONS = new Set([0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0x8e, 0xcb, 0xf5, 0xfb]);

interface DbfField {
  name: string;
  type: string;
  length: number;
  decimals: number;
  offset: number;
}

function readHeader(buffer: Buffer): {
  fields: DbfField[];
  headerLength: number;
  recordLength: number;
  declaredRecords: number;
} | null {
  if (buffer.length < 33 || !VERSIONS.has(buffer[0])) return null;
  const month = buffer[2];
  const day = buffer[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const declaredRecords = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  if (headerLength < 33 || headerLength > buffer.length || recordLength < 2) return null;
  const fields: DbfField[] = [];
  let offset = 1;
  for (let pos = 32; pos + 32 <= headerLength && buffer[pos] !== 0x0d; pos += 32) {
    if (fields.length >= 255) return null;
    const rawName = buffer.subarray(pos, pos + 11);
    const nul = rawName.indexOf(0);
    const name = rawName.subarray(0, nul === -1 ? 11 : nul).toString('latin1').trim();
    const type = String.fromCharCode(buffer[pos + 11]);
    const length = buffer[pos + 16];
    if (!/^[A-Za-z0-9_]*$/.test(name) || !/^[CNFDLMIBYT0GP@+O]$/.test(type)) return null;
    fields.push({ name, type, length, decimals: buffer[pos + 17], offset });
    offset += length;
  }
  if (fields.length === 0 || offset !== recordLength) return null;
  return { fields, headerLength, recordLength, declaredRecords };
}

function dbfDate(text: string): string {
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text;
}

export const dbfReader: FormatReader = {
  id: 'dbf',
  labelFa: 'DBF (dBase / FoxPro)',
  extensions: ['.dbf'],
  detect(buffer) {
    return readHeader(buffer) ? 0.85 : 0;
  },
  read(buffer) {
    const header = readHeader(buffer);
    if (!header) throw new ReaderError('فایل DBF معتبر نیست یا آسیب‌دیده است.');
    const { fields, headerLength, recordLength, declaredRecords } = header;
    const available = Math.floor((buffer.length - headerLength) / recordLength);
    const notes = new TableNotes();
    const extra: string[] = [];
    let count = declaredRecords;
    if (declaredRecords > available) {
      count = available;
      extra.push(
        `هدر DBF ${declaredRecords} رکورد اعلام کرده بود ولی فقط ${available} رکورد در فایل هست؛ همان‌ها خوانده شد.`,
      );
    }
    if (count > rowLimit()) {
      throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
    }
    if (fields.length > READER_LIMITS.maxColumns) {
      throw new ReaderError('تعداد ستون‌های DBF بیش از سقف مجاز است.');
    }

    // Pick the text encoding once from all character-field bytes.
    const sample: Buffer[] = [];
    let sampled = 0;
    for (let r = 0; r < count && sampled < 65_536; r += 1) {
      const base = headerLength + r * recordLength;
      for (const f of fields) {
        if (f.type === 'C') {
          const chunk = buffer.subarray(base + f.offset, base + f.offset + f.length);
          sample.push(chunk);
          sampled += chunk.length;
        }
      }
    }
    const sampleBuf = Buffer.concat(sample);
    let utf8 = false;
    let cp1256 = false;
    let hasHigh = false;
    for (const b of sampleBuf) if (b >= 0x80) hasHigh = true;
    if (hasHigh) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(sampleBuf);
        utf8 = true;
      } catch {
        const { high, share } = arabicShareOfHighBytes(sampleBuf);
        if (high >= 12 && share < 0.6) throw new ReaderError(IRAN_SYSTEM_MESSAGE);
        cp1256 = true;
        extra.push('رمزگذاری فیلدهای DBF Windows-1256 تشخیص داده شد.');
      }
    }
    const decode = utf8
      ? (b: Buffer): string => b.toString('utf8')
      : cp1256
        ? ((d) => (b: Buffer): string => d.decode(b))(new TextDecoder('windows-1256'))
        : (b: Buffer): string => b.toString('latin1');

    const matrix: unknown[][] = [fields.map((f) => f.name)];
    for (let r = 0; r < count; r += 1) {
      const base = headerLength + r * recordLength;
      if (buffer[base] === 0x2a) continue; // deleted record
      matrix.push(
        fields.map((f) => {
          const raw = buffer.subarray(base + f.offset, base + f.offset + f.length);
          switch (f.type) {
            case 'C':
              return decode(raw).replace(/\0+$/, '').trimEnd();
            case 'N':
            case 'F':
              return raw.toString('latin1').trim();
            case 'D':
              return dbfDate(raw.toString('latin1').trim());
            case 'L':
              return /^[TtYy]$/.test(raw.toString('latin1').trim()) ? 'true' : /^[FfNn]$/.test(raw.toString('latin1').trim()) ? 'false' : '';
            case 'I':
              return f.length >= 4 ? String(raw.readInt32LE(0)) : '';
            case 'B':
              return f.length >= 8 ? String(raw.readDoubleLE(0)) : '';
            case 'Y':
              return f.length >= 8 ? String(Number(raw.readBigInt64LE(0)) / 10_000) : '';
            default:
              return '';
          }
        }),
      );
    }
    return packageOf('dbf', [buildTable('data', matrix, notes)], notes, extra);
  },
};
