import { BadRequestException } from '@nestjs/common';
import { parseMinor } from '../../accounting/money';
import {
  fixPersianChars,
  normaliseKey,
  normaliseText,
  parseJalaliDate,
  toAsciiDigits,
} from '../../data_import/normaliser/normalise';
import { stringifyCell } from '../../data_import/parsers/package-source.types';
import { rowLimit } from '../../data_import/readers/limits';
import { ReaderError } from '../../data_import/readers/reader.types';
import { readFormat } from '../../data_import/readers/format-registry';

const SUPPORTED_KARTABLE_FORMATS = new Set(['csv', 'xlsx', 'xls']);
const PAGE_SIZE = 500;

export interface ParsedKartableRow {
  rowIndex: number;
  taxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  jalaliPeriod: { year: number; quarter: number } | null;
  counterpartyName: string | null;
  counterpartyNationalId: string | null;
  netMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
}

export interface ParsedKartableFile {
  formatId: string;
  rows: ParsedKartableRow[];
  totalRowsRead: number;
}

type FieldKey =
  | 'taxId'
  | 'invoiceNumber'
  | 'issueDate'
  | 'counterpartyName'
  | 'counterpartyNationalId'
  | 'netAmount'
  | 'vatAmount'
  | 'totalAmount';

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  taxId: [
    'شمارهمنحصربهفردمالیاتی',
    'شناسهیکتامالیاتی',
    'شناسهمالیاتی',
    'شمارهمالیاتی',
    'کدمالیاتی',
    'taxid',
    'tax_id',
    'taxid22',
  ],
  invoiceNumber: [
    'شمارهصورتحساب',
    'سریالصورتحساب',
    'شمارهفاکتور',
    'سریال',
    'inno',
    'invoicenumber',
    'taxinvoicenumber',
    'billno',
  ],
  issueDate: [
    'تاریخصدور',
    'تاریخصورتحساب',
    'تاریخ',
    'indatim',
    'issuedate',
    'issuedat',
    'date',
  ],
  counterpartyName: [
    'نامخریدار',
    'نامفروشنده',
    'نامکاملخریدار',
    'نامکاملفروشنده',
    'طرفحساب',
    'خریدار',
    'فروشنده',
    'counterparty',
    'buyername',
    'sellername',
    'partyname',
  ],
  counterpartyNationalId: [
    'کدملی',
    'شناسهملیاقتصادی',
    'شناسهملی',
    'کداقتصادی',
    'شمارهاقتصادی',
    'tinb',
    'tins',
    'bid',
    'nationalid',
  ],
  netAmount: [
    'مبلغپسازتخفیف',
    'مبغپسازتخفیف',
    'مبلغقبلازمالیات',
    'جمعمبلغقبلازمالیات',
    'مبلغخالص',
    'مبلغفروش',
    'مبلغکلکالایاخدمت',
    'tadis',
    'tprdis',
    'netamount',
    'taxableamount',
    'taxablebase',
  ],
  vatAmount: [
    'جمعمالیاتبرارزشافزوده',
    'مالیاتبرارزشافزوده',
    'مبلغارزشافزوده',
    'مبغارزشافزوده',
    'مبلغفیشمالیات',
    'مبلغمالیات',
    'مالیات',
    'ارزشافزوده',
    'tvam',
    'vat',
    'vatamount',
    'taxamount',
  ],
  totalAmount: [
    'مجموعمبلغصورتحساب',
    'جمعکلصورتحساب',
    'مبلغکلصورتحساب',
    'جمعکل',
    'مبلغکل',
    'مبلغقابلپرداخت',
    'tbill',
    'totalamount',
    'finalpayable',
    'total',
  ],
};

function normalizeHeaderKey(header: string): string {
  return normaliseKey(header).replace(/[:\-_()（）]/g, '');
}

function buildColumnMap(columnNames: string[]): Partial<Record<FieldKey, string>> {
  const normalized = columnNames.map(normalizeHeaderKey);
  const result: Partial<Record<FieldKey, string>> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[FieldKey, string[]]>) {
    const aliasSet = new Set(aliases.map((a) => normalizeHeaderKey(a)));
    const exactIndex = normalized.findIndex((col) => aliasSet.has(col));
    if (exactIndex !== -1) {
      result[field] = columnNames[exactIndex];
      continue;
    }
    const partialIndex = normalized.findIndex((col) =>
      aliases.some((alias) => col.includes(normalizeHeaderKey(alias))),
    );
    if (partialIndex !== -1) {
      result[field] = columnNames[partialIndex];
    }
  }
  return result;
}

/**
 * تبدیل متن مبلغ (مثلاً «۱۲٬۵۰۰٬۰۰۰ ریال» یا «۲٬۵۰۰٬۰۰۰ تومان») به واحد فرعی دقیق ریال (BigInt × ۱۰۰) بدون حساب اعشاری.
 */
export function parseKartableMoneyToMinor(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;
  const text = fixPersianChars(toAsciiDigits(stringifyCell(raw))).trim();
  if (!text) return null;

  const isToman = /تومان/.test(text);
  const isRial = /ریال/.test(text);
  const cleaned = text
    .replace(/تومان|ریال|irr|irt/gi, '')
    .replace(/[٬,\s_']/g, '')
    .replace(/٫/g, '.')
    .trim();
  if (!cleaned) return null;

  try {
    const minor = parseMinor(cleaned);
    return isToman && !isRial ? minor * 10n : minor;
  } catch {
    return null;
  }
}

function tehranJalaliYearQuarter(date: Date): { year: number; quarter: number } | null {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const yearVal = Number(parts.find((p) => p.type === 'year')?.value ?? NaN);
  const monthVal = Number(parts.find((p) => p.type === 'month')?.value ?? NaN);
  if (!Number.isInteger(yearVal) || !Number.isInteger(monthVal) || monthVal < 1 || monthVal > 12) {
    return null;
  }
  return {
    year: yearVal,
    quarter: Math.floor((monthVal - 1) / 3) + 1,
  };
}

export function normalizeTaxId(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = toAsciiDigits(value)
    .trim()
    .replace(/[\s\-_]/g, '')
    .toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeInvoiceNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = normaliseText(value).toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

function parseIssueDate(raw: unknown): {
  isoDate: string | null;
  jalaliPeriod: { year: number; quarter: number } | null;
} {
  const text = stringifyCell(raw).trim();
  if (!text) return { isoDate: null, jalaliPeriod: null };
  const isoDate = parseJalaliDate(text);
  if (!isoDate) return { isoDate: null, jalaliPeriod: null };
  const dateObj = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(dateObj.getTime())) return { isoDate, jalaliPeriod: null };
  return { isoDate, jalaliPeriod: tehranJalaliYearQuarter(dateObj) };
}

/**
 * خواندن و نرمال‌سازی فایل خروجی کارپوشه مودیان (CSV / XLSX / XLS) با تکیه بر `data_import`.
 */
export async function parseKartableExportFile(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedKartableFile> {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('فایل بارگذاری‌شده خالی است.');
  }

  let pkg;
  try {
    pkg = await readFormat(buffer, fileName);
  } catch (err) {
    const message =
      err instanceof ReaderError
        ? err.message
        : 'فرمت فایل معتبر نیست؛ لطفاً فایل CSV یا XLSX خروجی کارپوشه مودیان بارگذاری کنید.';
    throw new BadRequestException(message);
  }

  try {
    const formatId = pkg.formatId ?? 'unknown';
    if (!SUPPORTED_KARTABLE_FORMATS.has(formatId)) {
      throw new BadRequestException(
        `فرمت «${formatId}» پشتیبانی نمی‌شود؛ فقط فایل‌های CSV یا Excel (XLSX/XLS) خروجی کارپوشه پذیرفته می‌شوند.`,
      );
    }

    const table = pkg.tables[0];
    if (!table || table.columns.length === 0) {
      throw new BadRequestException('هیچ جدولی با سربرگ معتبر در فایل یافت نشد.');
    }

    const columnNames = table.columns.map((c) => c.name);
    const colMap = buildColumnMap(columnNames);

    if (
      colMap.taxId === undefined &&
      colMap.invoiceNumber === undefined &&
      colMap.totalAmount === undefined &&
      colMap.netAmount === undefined
    ) {
      throw new BadRequestException(
        'ستون‌های ضروری کارپوشه (شماره مالیاتی/صورتحساب یا مبالغ) در فایل تشخیص داده نشد.',
      );
    }

    const limit = rowLimit();
    const rows: ParsedKartableRow[] = [];
    let offset = 0;

    while (offset < table.rowCount && offset < limit) {
      const chunk = table.readPage(offset, Math.min(PAGE_SIZE, limit - offset));
      if (chunk.length === 0) break;

      for (let i = 0; i < chunk.length; i += 1) {
        const rawRow = chunk[i];
        const rowNumber = offset + i + 2; // 1-based data row (+1 header)
        const cellAt = (key: FieldKey): unknown => {
          const colName = colMap[key];
          return colName !== undefined ? rawRow[colName] : undefined;
        };

        const taxId = normalizeTaxId(stringifyCell(cellAt('taxId')));
        const invoiceNumberRaw = normaliseText(stringifyCell(cellAt('invoiceNumber')));
        const invoiceNumber = invoiceNumberRaw || null;

        const vatParsed = parseKartableMoneyToMinor(cellAt('vatAmount'));
        const netParsed = parseKartableMoneyToMinor(cellAt('netAmount'));
        const totalParsed = parseKartableMoneyToMinor(cellAt('totalAmount'));

        // Skip completely empty trailing rows
        if (!taxId && !invoiceNumber && vatParsed === null && netParsed === null && totalParsed === null) {
          continue;
        }

        const vatMinor = vatParsed ?? 0n;
        let netMinor: bigint;
        let totalMinor: bigint;

        if (totalParsed !== null && netParsed !== null) {
          netMinor = netParsed;
          totalMinor = totalParsed;
        } else if (totalParsed !== null) {
          totalMinor = totalParsed;
          netMinor = totalParsed - vatMinor;
        } else if (netParsed !== null) {
          netMinor = netParsed;
          totalMinor = netParsed + vatMinor;
        } else {
          netMinor = 0n;
          totalMinor = vatMinor;
        }

        const counterpartyNameRaw = normaliseText(stringifyCell(cellAt('counterpartyName')));
        const counterpartyNationalIdRaw = toAsciiDigits(stringifyCell(cellAt('counterpartyNationalId'))).replace(/\D/g, '');
        const { isoDate, jalaliPeriod } = parseIssueDate(cellAt('issueDate'));

        rows.push({
          rowIndex: rowNumber,
          taxId,
          invoiceNumber,
          issueDate: isoDate,
          jalaliPeriod,
          counterpartyName: counterpartyNameRaw || null,
          counterpartyNationalId: counterpartyNationalIdRaw || null,
          netMinor,
          vatMinor,
          totalMinor,
        });
      }

      offset += chunk.length;
    }

    return {
      formatId,
      rows,
      totalRowsRead: offset,
    };
  } finally {
    pkg.close();
  }
}
