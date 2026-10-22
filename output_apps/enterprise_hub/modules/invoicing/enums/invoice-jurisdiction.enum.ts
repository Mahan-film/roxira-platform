/**
 * حوزه قضایی/مالیاتی صورتحساب.
 *
 * - IR: صورتحساب داخلی؛ نمایش تاریخ جلالی و مبالغ ریالی/تومانی و VAT پیش‌فرض ۱۰٪.
 * - INTL: صورتحساب بین‌المللی؛ مبالغ به ارز خودِ صورتحساب و VAT پیش‌فرض صفر.
 */
export enum InvoiceJurisdiction {
  IR = 'IR',
  INTL = 'INTL',
}

/** فهرست مقادیر مجاز حوزه قضایی (برای اعتبارسنجی DTO). */
export const INVOICE_JURISDICTIONS: InvoiceJurisdiction[] = [
  InvoiceJurisdiction.IR,
  InvoiceJurisdiction.INTL,
];
