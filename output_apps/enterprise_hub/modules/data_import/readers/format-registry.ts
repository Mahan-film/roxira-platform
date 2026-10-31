/**
 * ثبت‌کنندهٔ خوانندگان قالب و «تشخیص بر پایهٔ محتوا».
 *
 * هر خواننده روی بایت‌ها امتیاز می‌دهد؛ بیشترین امتیاز برنده است و پسوند فقط ۰٫۰۵ امتیاز تساوی‌شکن
 * اضافه می‌کند. زیر آستانهٔ ۰٫۲۵ فایل «ناشناخته» است و رد می‌شود.
 */

import { ParsedPackage } from '../parsers/package-source.types';
import { mssqlScriptReader, mysqlDumpReader, postgresDumpReader } from './sql-dump.reader';
import { iifReader, ofxReader } from './accounting-formats.reader';
import { createZipReader, mergeFiles, sqliteReader, sqliteSqlReader, xlsxReader } from './container.readers';
import { dbfReader } from './dbf.reader';
import { accessReader, imageReader, mssqlBackupReader, pgCustomReader } from './guide-only.readers';
import { pdfReader } from './pdf.reader';
import { odsReader } from './ods.reader';
import { FormatId, FormatReader, ReaderError } from './reader.types';
import { csvReader, fixedWidthReader, htmlTableReader, jsonReader, xmlReader } from './text-formats.reader';
import { xlsReader } from './xls.reader';

export const UNKNOWN_FORMAT_MESSAGE =
  'قالب این فایل از روی محتوا شناخته نشد. قالب‌های پشتیبانی‌شده در جدول «فرمت‌های پشتیبانی‌شده» آمده است؛ ' +
  'در صورت نیاز از نرم‌افزار قبلی خروجی اکسل/CSV بگیرید.';

const MIN_CONFIDENCE = 0.25;

async function readInner(buffer: Buffer, fileName: string, depth: number): Promise<ParsedPackage> {
  return readFormat(buffer, fileName, depth);
}

const zipReader = createZipReader(readInner);

export const FORMAT_READERS: readonly FormatReader[] = [
  sqliteReader,
  accessReader,
  mssqlBackupReader,
  pgCustomReader,
  pdfReader,
  imageReader,
  xlsReader,
  xlsxReader,
  odsReader,
  zipReader,
  dbfReader,
  iifReader,
  ofxReader,
  postgresDumpReader,
  mysqlDumpReader,
  mssqlScriptReader,
  sqliteSqlReader,
  htmlTableReader,
  xmlReader,
  jsonReader,
  csvReader,
  fixedWidthReader,
];

export interface Detection {
  id: FormatId;
  confidence: number;
  reader: FormatReader | null;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function detectFormat(buffer: Buffer, fileName = ''): Detection {
  if (buffer.length === 0) return { id: 'unknown', confidence: 0, reader: null };
  const ext = extensionOf(fileName);
  let best: Detection = { id: 'unknown', confidence: 0, reader: null };
  for (const reader of FORMAT_READERS) {
    let score = 0;
    try {
      score = reader.detect(buffer, fileName);
    } catch {
      score = 0;
    }
    if (score > 0 && reader.extensions.includes(ext)) score += 0.05;
    if (score > best.confidence) best = { id: reader.id, confidence: score, reader };
  }
  return best.confidence >= MIN_CONFIDENCE ? best : { id: 'unknown', confidence: best.confidence, reader: null };
}

export async function readFormat(buffer: Buffer, fileName: string, depth = 0): Promise<ParsedPackage> {
  const detection = detectFormat(buffer, fileName);
  if (!detection.reader) throw new ReaderError(UNKNOWN_FORMAT_MESSAGE);
  const pkg = await detection.reader.read(buffer, { fileName, depth });
  pkg.formatId = pkg.formatId ?? detection.id;
  return pkg;
}

/** خواندن با قالب از پیش‌تشخیص‌داده‌شده (بدون تشخیص دوباره). */
export async function readFormatAs(id: FormatId, buffer: Buffer, fileName: string): Promise<ParsedPackage> {
  const reader = FORMAT_READERS.find((r) => r.id === id);
  if (!reader) throw new ReaderError(UNKNOWN_FORMAT_MESSAGE);
  const pkg = await reader.read(buffer, { fileName, depth: 0 });
  pkg.formatId = pkg.formatId ?? id;
  return pkg;
}

/** چند فایل (پوشه یا انتخاب چندتایی) → یک بسته. `load` فایل‌ها را یکی‌یکی می‌خواند تا حافظه آزاد بماند. */
export function readMultiFiles(
  count: number,
  load: (index: number) => { name: string; buffer: Buffer } | null,
): Promise<ParsedPackage> {
  return mergeFiles(count, load, readInner, 0, 'multi');
}
