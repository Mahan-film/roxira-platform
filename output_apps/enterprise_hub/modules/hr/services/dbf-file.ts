/**
 * Minimal dBase III table writer and reader for the SSO insurance list. Text is Windows-1256;
 * the code page comes from the runtime's decoder, so no character table lives here.
 */
export interface DbfField {
  name: string;
  type: 'C' | 'N';
  length: number;
}

export type DbfRow = Record<string, string | number>;

const LANGUAGE_DRIVER_CP1256 = 0x7e;
const HEADER_LENGTH = 32;
const FIELD_LENGTH = 32;

const buildEncoder = (): Map<string, number> => {
  const decoder = new TextDecoder('windows-1256');
  const map = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) {
    map.set(decoder.decode(Uint8Array.of(byte)), byte);
  }
  return map;
};

let encoder: Map<string, number> | null = null;

/** Persian ye has no Windows-1256 byte; the Arabic form is the code page's letter. */
const normalise = (text: string): string => text.replace(/ی/g, 'ي');

function encodeText(text: string): number[] {
  encoder ??= buildEncoder();
  return [...normalise(text)].map((char) => encoder?.get(char) ?? 0x3f);
}

/** Byte length of a text once encoded for a DBF cell. */
export const encodedLength = (text: string): number => encodeText(text).length;

function encodeCell(field: DbfField, value: string | number): number[] {
  const bytes = encodeText(String(value ?? ''));
  if (bytes.length > field.length) {
    if (field.type === 'N') {
      throw new Error(`${field.name}: ${value} is wider than ${field.length}`);
    }
    return bytes.slice(0, field.length);
  }
  const padding = new Array<number>(field.length - bytes.length).fill(0x20);
  return field.type === 'N' ? [...padding, ...bytes] : [...bytes, ...padding];
}

export function writeDbf(
  fields: ReadonlyArray<DbfField>,
  rows: ReadonlyArray<DbfRow>,
  date: Date,
): Buffer {
  const headerSize = HEADER_LENGTH + fields.length * FIELD_LENGTH + 1;
  const recordSize = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const out = Buffer.alloc(headerSize + rows.length * recordSize + 1, 0);

  out[0] = 0x03;
  out[1] = date.getUTCFullYear() - 1900;
  out[2] = date.getUTCMonth() + 1;
  out[3] = date.getUTCDate();
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(headerSize, 8);
  out.writeUInt16LE(recordSize, 10);
  out[29] = LANGUAGE_DRIVER_CP1256;

  fields.forEach((field, index) => {
    const at = HEADER_LENGTH + index * FIELD_LENGTH;
    out.write(field.name.slice(0, 10), at, 'ascii');
    out[at + 11] = field.type.charCodeAt(0);
    out[at + 16] = field.length;
  });
  out[headerSize - 1] = 0x0d;

  let at = headerSize;
  for (const row of rows) {
    out[at] = 0x20;
    at += 1;
    for (const field of fields) {
      const bytes = encodeCell(field, row[field.name]);
      out.set(bytes, at);
      at += field.length;
    }
  }
  out[at] = 0x1a;
  return out;
}

/** Reads back what `writeDbf` wrote; the export validates the file bytes, not its own inputs. */
export function readDbf(file: Buffer): DbfRow[] {
  const count = file.readUInt32LE(4);
  const headerSize = file.readUInt16LE(8);
  const recordSize = file.readUInt16LE(10);
  const fields: DbfField[] = [];
  for (let at = HEADER_LENGTH; file[at] !== 0x0d; at += FIELD_LENGTH) {
    fields.push({
      name: file.toString('ascii', at, at + 11).replace(/\0.*$/, ''),
      type: String.fromCharCode(file[at + 11]) as 'C' | 'N',
      length: file[at + 16],
    });
  }
  const decoder = new TextDecoder('windows-1256');
  const rows: DbfRow[] = [];
  for (let index = 0; index < count; index += 1) {
    let at = headerSize + index * recordSize + 1;
    const row: DbfRow = {};
    for (const field of fields) {
      const text = decoder.decode(file.subarray(at, at + field.length)).trim();
      row[field.name] = field.type === 'N' ? Number(text || 0) : text;
      at += field.length;
    }
    rows.push(row);
  }
  return rows;
}
