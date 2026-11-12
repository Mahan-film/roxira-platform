/**
 * Official layout constants for the electronic commercial books export
 * (دفاتر تجاری الکترونیکی) per `docs/tax/official/electronic-books-template.xlsx`
 * downloaded from my.tax.gov.ir on 2026-11-11.
 *
 * One sheet (`Sheet1`), row 1 headers, columns A-I.
 */

export const OFFICIAL_ELECTRONIC_BOOKS_HEADERS = [
  'کد حساب کل',
  'عنوان حساب کل',
  'کد حساب معین',
  'عنوان حساب معین',
  'کد حساب تفصیلی',
  'عنوان حساب تفصیلی',
  'گردش بدهکار (میلیون ریال)',
  'گردش بستانکار (میلیون ریال)',
  'تاریخ گردش حساب',
] as const;

export const RIAL_ELECTRONIC_BOOKS_HEADERS = [
  'کد حساب کل',
  'عنوان حساب کل',
  'کد حساب معین',
  'عنوان حساب معین',
  'کد حساب تفصیلی',
  'عنوان حساب تفصیلی',
  'گردش بدهکار (ریال)',
  'گردش بستانکار (ریال)',
  'تاریخ گردش حساب',
] as const;

export type ElectronicBooksUnit = 'million_rial' | 'rial';
export type ElectronicBooksVoucherScope = 'operational' | 'opening' | 'closing_temp' | 'closing_perm';

export function getElectronicBooksHeaders(unit: ElectronicBooksUnit = 'million_rial'): readonly string[] {
  return unit === 'rial' ? RIAL_ELECTRONIC_BOOKS_HEADERS : OFFICIAL_ELECTRONIC_BOOKS_HEADERS;
}

/** Threshold above which auto format switches from XLSX to UTF-8 CSV (official guideline). */
export const ELECTRONIC_BOOKS_XLSX_ROW_LIMIT = 1000;
export const ELECTRONIC_BOOKS_CSV_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_ROUNDING_KOL_CODE = '99';
export const DEFAULT_ROUNDING_KOL_NAME = 'حساب‌های انتظامی و تعدیل';
export const DEFAULT_ROUNDING_ACCOUNT_CODE = '9999';
export const DEFAULT_ROUNDING_ACCOUNT_NAME = 'تفاوت گرد کردن دفاتر تجاری';
export const AUDIT_ACTION_ELECTRONIC_BOOKS_EXPORT = 'TAX_ELECTRONIC_BOOKS_EXPORTED';

/** Marked unverified until live portal upload confirms rounding and unit rules against my.tax.gov.ir. */
export const ELECTRONIC_BOOKS_LAYOUT_STATUS = 'unverified' as const;

export interface ElectronicBookTurnoverRow {
  kolCode: string;
  kolName: string;
  moeinCode: string;
  moeinName: string;
  tafsiliCode: string;
  tafsiliName: string;
  debitTurnoverMillion: string;
  creditTurnoverMillion: string;
  turnoverDateJalali: string;
}
