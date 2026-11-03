import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { bulkTmpDir } from '../bulk.constants';
import { readFormat } from '../../readers/format-registry';
import { CsvStreamParser } from './csv-parser';
import { sniffSource, SourceKind, extensionOf } from './sniff';
import { SqlStreamParser } from './sql-parser';
import { Cell, ImportFileError, labelOf, ParseEvent, PushParser } from './types';
import { XlsxStreamReader } from './xlsx-parser';
import { ZipEntryHandler, ZipWalker } from './zip-walker';

export interface SourceInput {
  fileName: string;
  size: number;
  /** Opens the object from byte 0. Called more than once (head sniff, then the real pass). */
  open(): Promise<Readable>;
  /** Largest file the whole-file legacy readers may load into memory. */
  legacyMaxBytes: number;
}

export async function readHead(open: () => Promise<Readable>, bytes = 64 * 1024): Promise<Buffer> {
  const stream = await open();
  const parts: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      parts.push(buf);
      total += buf.length;
      if (total >= bytes) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(parts).subarray(0, bytes);
}

/** Streams ParseEvents out of any supported file with bounded memory. Never executes file content. */
export async function* parseSource(input: SourceInput): AsyncGenerator<ParseEvent> {
  const head = await readHead(input.open);
  if (head.length === 0) throw new ImportFileError('فایل خالی است.');
  const kind = sniffSource(head, input.fileName);
  const base = labelOf(input.fileName.replace(/\.[^.]*$/, ''), 'data');
  switch (kind) {
    case 'csv':
      yield* streamThrough(input.open, new CsvStreamParser(base));
      return;
    case 'sql':
      yield* streamThrough(input.open, new SqlStreamParser(base));
      return;
    case 'xlsx': {
      const reader = new XlsxStreamReader(input.open, '');
      try {
        yield* reader.read();
      } finally {
        reader.close();
      }
      return;
    }
    case 'zip':
      yield* parseZip(input.open);
      return;
    default:
      yield* parseLegacy(input);
  }
}

async function* streamThrough(open: () => Promise<Readable>, parser: PushParser): AsyncGenerator<ParseEvent> {
  const stream = await open();
  try {
    for await (const chunk of stream) yield* parser.push(chunk as Uint8Array);
    yield* parser.end();
  } finally {
    stream.destroy();
  }
}

async function* parseZip(open: () => Promise<Readable>): AsyncGenerator<ParseEvent> {
  const sink: ParseEvent[] = [];
  const spooled: Array<{ file: string; label: string }> = [];
  const tmp = path.join(bulkTmpDir(), `roxira-zip-${randomUUID()}`);
  let created = false;
  const seenTables = new Set<string>();
  const walker = new ZipWalker({
    onNote: (message) => sink.push({ kind: 'note', message }),
    onEntry: (name) => {
      const ext = extensionOf(name);
      const label = labelOf(name.replace(/\.[^./]*$/, ''), 'data');
      if (seenTables.has(label)) {
        sink.push({ kind: 'note', message: `«${name}»: نام تکراری؛ نادیده گرفته شد.` });
        return null;
      }
      if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
        seenTables.add(label);
        return wrapParser(new CsvStreamParser(label), sink);
      }
      if (ext === '.sql') {
        seenTables.add(label);
        return wrapParser(new SqlStreamParser(label), sink);
      }
      if (ext === '.xlsx' || ext === '.xlsm') {
        seenTables.add(label);
        if (!created) {
          fs.mkdirSync(tmp, { recursive: true });
          created = true;
        }
        const file = path.join(tmp, `${spooled.length}.xlsx`);
        const fd = fs.openSync(file, 'w');
        spooled.push({ file, label });
        return {
          data: (chunk) => void fs.writeSync(fd, chunk),
          end: () => fs.closeSync(fd),
        };
      }
      sink.push({ kind: 'note', message: `«${name}»: قالب ${ext || 'نامشخص'} داخل ZIP خوانده نمی‌شود؛ آن را جداگانه بارگذاری کنید.` });
      return null;
    },
  });
  const source = await open();
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
    for (const item of spooled) {
      const reader = new XlsxStreamReader(async () => fs.createReadStream(item.file), item.label);
      try {
        yield* reader.read();
      } finally {
        reader.close();
        await fsp.rm(item.file, { force: true });
      }
    }
    if (seenTables.size === 0) throw new ImportFileError('هیچ فایل CSV، SQL یا XLSX قابل‌خواندن داخل ZIP پیدا نشد.');
  } finally {
    source.destroy();
    if (created) await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function wrapParser(parser: PushParser, sink: ParseEvent[]): ZipEntryHandler {
  return {
    data: (chunk) => {
      for (const event of parser.push(chunk)) sink.push(event);
    },
    end: () => {
      for (const event of parser.end()) sink.push(event);
    },
  };
}

/** Whole-file readers (XLS, ODS, DBF, JSON, XML, OFX, IIF, SQLite, PDF…) for files within their memory cap. */
async function* parseLegacy(input: SourceInput): AsyncGenerator<ParseEvent> {
  if (input.size > input.legacyMaxBytes) {
    throw new ImportFileError(
      `این قالب فقط تا ${Math.round(input.legacyMaxBytes / 1024 / 1024)} مگابایت خوانده می‌شود. برای فایل بزرگ‌تر خروجی CSV یا SQL بگیرید.`,
    );
  }
  const chunks: Buffer[] = [];
  const stream = await input.open();
  try {
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  } finally {
    stream.destroy();
  }
  const buffer = Buffer.concat(chunks);
  chunks.length = 0;
  let pkg;
  try {
    pkg = await readFormat(buffer, input.fileName);
  } catch (error) {
    throw new ImportFileError((error as Error).message || 'قالب فایل خوانده نشد.');
  }
  try {
    for (const note of pkg.notes ?? []) yield { kind: 'note', message: note };
    for (const table of pkg.tables) {
      const columns = table.columns.map((column) => column.name);
      yield { kind: 'table', table: labelOf(table.name, 'data'), columns };
      for (let offset = 0; offset < table.rowCount; offset += 2000) {
        const page = table.readPage(offset, 2000);
        const rows: Cell[][] = page.map((record) =>
          columns.map((name) => {
            const value = record[name];
            return value === null || value === undefined ? null : String(value);
          }),
        );
        yield { kind: 'rows', table: labelOf(table.name, 'data'), rows };
      }
    }
  } finally {
    pkg.close();
  }
}

export type { SourceKind };
