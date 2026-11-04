/**
 * Ledger accounts used by treasury postings. 1010, 1020 and 2010 are in the default chart; the
 * others are created per tenant on first use (see TreasuryLedgerPostingAdapter). Account names need
 * the accountant's confirmation (docs/accounting/TREASURY.md).
 */
export const TREASURY_ACCOUNTS = {
  /** صندوق (cash box). */
  CASH: '1011',
  /** Bank and card clearing: bank transfers and card receipts land here (same as modules/banking). */
  BANK: '1010',
  RECEIVABLES: '1020',
  PAYABLES: '2010',
  /** پیش‌پرداخت‌ها: money paid to a supplier ahead of an invoice (asset). */
  SUPPLIER_ADVANCES: '1040',
  /** پیش‌دریافت‌ها: money received from a customer ahead of an invoice (liability). */
  CUSTOMER_ADVANCES: '2070',
  /** برگشت از فروش و تخفیفات: small differences written off on a receipt. */
  WRITEOFF_RECEIPT: '4030',
  /** Small differences written off on a payment (income to us). */
  WRITEOFF_PAYMENT: '4090',
} as const;

export const TREASURY_ACCOUNT_DEFINITIONS = [
  { code: TREASURY_ACCOUNTS.CASH, name: 'صندوق', accountType: 'ASSET' },
  { code: TREASURY_ACCOUNTS.SUPPLIER_ADVANCES, name: 'پیش‌پرداخت‌ها', accountType: 'ASSET' },
  { code: TREASURY_ACCOUNTS.CUSTOMER_ADVANCES, name: 'پیش‌دریافت‌ها', accountType: 'LIABILITY' },
  { code: TREASURY_ACCOUNTS.WRITEOFF_RECEIPT, name: 'برگشت از فروش و تخفیفات', accountType: 'REVENUE' },
  { code: TREASURY_ACCOUNTS.WRITEOFF_PAYMENT, name: 'تخفیفات نقدی دریافتی', accountType: 'REVENUE' },
] as const;

export const PG_UNIQUE_VIOLATION = '23505';

/** Largest number of method lines or allocation rows on one document. */
export const MAX_DOC_ROWS = 200;
