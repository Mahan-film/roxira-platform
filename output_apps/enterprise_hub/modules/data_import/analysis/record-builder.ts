/**
 * ساخت ردیف‌های نرمال‌شده از یک جدول بر پایهٔ نگاشت. مشترک بین «مغایرت‌گیری» و «ثبت نهایی» تا هر دو
 * دقیقاً یک منطق را ببینند (آنچه گزارش می‌شود همان است که ثبت می‌شود).
 */

import { PACKAGE_MAX_ERRORS } from '../constants/package-import.constants';
import {
  PackageTableReader,
  stringifyCell,
} from '../parsers/package-source.types';
import { normaliseAndValidate } from '../registry/field-validation';
import {
  EntityImportAdapter,
  NormalisedRecord,
} from '../registry/import-registry.types';
import { iterateRows } from './package-analysis';

export interface BuildRecordsOptions {
  /** ضریب تبدیل مبلغ ستون‌های پولی به ریال (۱۰ برای تومان)؛ مبلغ‌هایی که خودشان واحد دارند دست نمی‌خورند. */
  moneyToRial?: number;
  /** Rows of this table already handled before this page (paged posting keeps row numbers global). */
  rowOffset?: number;
}

export interface BuiltRecords {
  records: NormalisedRecord[];
  errors: string[];
  /** تعداد کل ردیف‌های ناموفق (errors به PACKAGE_MAX_ERRORS بریده می‌شود). */
  invalidRows: number;
}

/** ادغام نگاشت ارسالی کاربر با نگاشت پیشنهادی تحلیل. */
export function concreteMapping(
  adapter: EntityImportAdapter,
  provided: Record<string, string | null>,
  fallback: Record<string, string | null>,
): Record<string, string> {
  const known = new Set(adapter.fields.map((field) => field.key));
  const result: Record<string, string> = {};
  const source = Object.keys(provided).length > 0 ? provided : fallback;
  for (const [column, field] of Object.entries(source)) {
    if (field && known.has(field)) {
      result[column] = field;
    }
  }
  return result;
}

const HAS_UNIT = /تومان|ریال|toman|rial/i;

export function buildRecords(
  adapter: EntityImportAdapter,
  table: PackageTableReader,
  mapping: Record<string, string>,
  options: BuildRecordsOptions = {},
): BuiltRecords {
  const columnByField = new Map<string, string>();
  for (const [column, field] of Object.entries(mapping)) {
    if (field && !columnByField.has(field)) {
      columnByField.set(field, column);
    }
  }
  const scale = options.moneyToRial && options.moneyToRial > 0 ? options.moneyToRial : 1;
  const records: NormalisedRecord[] = [];
  const errors: string[] = [];
  let invalidRows = 0;
  let rowNumber = 1 + (options.rowOffset ?? 0);

  for (const row of iterateRows(table)) {
    rowNumber += 1;
    const values: Record<string, unknown> = {};
    let valid = true;

    for (const field of adapter.fields) {
      const column = columnByField.get(field.key);
      const raw = column === undefined ? '' : stringifyCell(row[column]).trim();
      if (raw === '') {
        if (field.required) {
          valid = false;
          if (errors.length < PACKAGE_MAX_ERRORS) {
            errors.push(`ردیف ${rowNumber}: ${field.labelFa} الزامی است.`);
          }
        }
        continue;
      }
      const { value, error } = normaliseAndValidate(field, raw);
      if (error) {
        valid = false;
        if (errors.length < PACKAGE_MAX_ERRORS) {
          errors.push(`ردیف ${rowNumber}: ${error}`);
        }
        continue;
      }
      values[field.key] =
        scale !== 1 && field.type === 'money' && typeof value === 'number' && !HAS_UNIT.test(raw)
          ? Math.round(value * scale)
          : value;
    }

    if (valid) {
      records.push({ rowNumber, values });
    } else {
      invalidRows += 1;
    }
  }

  return { records, errors, invalidRows };
}
