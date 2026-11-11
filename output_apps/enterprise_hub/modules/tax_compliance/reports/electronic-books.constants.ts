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

export const ELECTRONIC_BOOKS_LAYOUT_STATUS = 'official' as const;

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
