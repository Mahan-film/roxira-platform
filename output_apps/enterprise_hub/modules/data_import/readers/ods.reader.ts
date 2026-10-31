/** خواندن OpenDocument Spreadsheet (ODS، LibreOffice) از content.xml با تجزیه‌گر امن XML. */

import {
  extractZipEntry,
  InflateBudget,
  listZipEntries,
  ZipReadError,
} from '../parsers/zip-reader';
import { PACKAGE_MAX_UNCOMPRESSED_BYTES } from '../constants/package-import.constants';
import { READER_LIMITS, rowLimit } from './limits';
import { FormatReader, ReaderError } from './reader.types';
import { buildTable, TableNotes, uniqueTableName } from './tabular';
import { packageOf } from './text-formats.reader';
import { childrenNamed, firstNamed, parseXml, XmlNode } from './xml-lite';

const BAD = 'فایل ODS معتبر نیست یا آسیب‌دیده است.';

function zipNames(buffer: Buffer): string[] | null {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
  try {
    return listZipEntries(buffer).map((e) => e.name);
  } catch {
    return null;
  }
}

export function zipMimetype(buffer: Buffer): string | null {
  try {
    const entry = listZipEntries(buffer).find((e) => e.name === 'mimetype');
    if (!entry || entry.declaredSize > 256) return null;
    return extractZipEntry(buffer, entry, { remaining: 1024 }).toString('latin1').trim();
  } catch {
    return null;
  }
}

function cellText(cell: XmlNode): string {
  const type = cell.attrs['value-type'];
  if (type === 'float' || type === 'percentage' || type === 'currency') {
    return cell.attrs.value ?? '';
  }
  if (type === 'date') return cell.attrs['date-value'] ?? '';
  if (type === 'time') return cell.attrs['time-value'] ?? '';
  if (type === 'boolean') return cell.attrs['boolean-value'] ?? '';
  return childrenNamed(cell, 'p')
    .map((p) => p.text + p.children.map((c) => c.text).join(''))
    .join('\n');
}

export const odsReader: FormatReader = {
  id: 'ods',
  labelFa: 'OpenDocument (ODS)',
  extensions: ['.ods'],
  detect(buffer) {
    const names = zipNames(buffer);
    if (!names || !names.includes('content.xml')) return 0;
    return /spreadsheet/.test(zipMimetype(buffer) ?? '') ? 0.95 : 0;
  },
  read(buffer) {
    let xml: string;
    try {
      const entry = listZipEntries(buffer).find((e) => e.name === 'content.xml');
      if (!entry) throw new ReaderError(BAD);
      const budget: InflateBudget = { remaining: PACKAGE_MAX_UNCOMPRESSED_BYTES };
      xml = extractZipEntry(buffer, entry, budget).toString('utf8');
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      if (error instanceof ZipReadError && error.code === 'too_large') {
        throw new ReaderError('حجم بازِ فایل ODS بیش از سقف مجاز است.');
      }
      throw new ReaderError(BAD);
    }
    const root = parseXml(xml);
    const body = firstNamed(root, 'body');
    const spreadsheet = body ? firstNamed(body, 'spreadsheet') : undefined;
    if (!spreadsheet) throw new ReaderError(BAD);
    const sheets = childrenNamed(spreadsheet, 'table');
    if (sheets.length > READER_LIMITS.maxSheetsPerWorkbook) {
      throw new ReaderError('تعداد برگه‌های فایل بیش از سقف مجاز است.');
    }
    const notes = new TableNotes();
    const used = new Set<string>();
    const tables = sheets.map((sheet) => {
      const matrix: string[][] = [];
      let nonEmpty = 0;
      const rowNodes: XmlNode[] = [];
      for (const child of sheet.children) {
        if (child.name === 'table-row') rowNodes.push(child);
        else if (child.name === 'table-row-group' || child.name === 'table-header-rows') {
          rowNodes.push(...childrenNamed(child, 'table-row'));
        }
      }
      for (const row of rowNodes) {
        const cells: string[] = [];
        for (const cell of row.children) {
          if (cell.name !== 'table-cell' && cell.name !== 'covered-table-cell') continue;
          const repeat = Math.max(1, Number(cell.attrs['number-columns-repeated'] ?? '1') || 1);
          const text = cell.name === 'table-cell' ? cellText(cell) : '';
          if (text === '') {
            if (cells.length + repeat <= READER_LIMITS.maxColumns) {
              for (let i = 0; i < repeat; i += 1) cells.push('');
            }
            continue;
          }
          if (repeat > 64) throw new ReaderError(BAD);
          for (let i = 0; i < repeat && cells.length < READER_LIMITS.maxColumns; i += 1) cells.push(text);
        }
        const repeatRows = Math.max(1, Number(row.attrs['number-rows-repeated'] ?? '1') || 1);
        if (!cells.some((c) => c !== '')) continue;
        if (repeatRows > 64) throw new ReaderError(BAD);
        for (let i = 0; i < repeatRows; i += 1) {
          matrix.push(cells);
          nonEmpty += 1;
        }
        if (nonEmpty > rowLimit() + 50) {
          throw new ReaderError(`حداکثر ${rowLimit()} ردیف در هر بسته مجاز است.`);
        }
      }
      return buildTable(uniqueTableName(sheet.attrs.name || 'Sheet', used), matrix, notes, { autoHeader: true });
    });
    return packageOf('ods', tables, notes);
  },
};
