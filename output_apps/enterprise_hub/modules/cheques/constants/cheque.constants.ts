/** Sayad identifier printed on every cheque leaf: exactly 16 digits. */
export const SAYAD_NUMBER_LENGTH = 16;

export const PG_UNIQUE_VIOLATION = '23505';

/** Default look-ahead for the due-date list. */
export const DEFAULT_DUE_WINDOW_DAYS = 30;
export const MAX_DUE_WINDOW_DAYS = 366;

/**
 * Ledger accounts used by cheque postings. 1010/1020/2010 exist in the default
 * chart; the three cheque accounts are created per tenant on first use.
 * Account names follow the usual Iranian chart naming and need the accountant's
 * confirmation (docs/accounting/CHEQUES.md).
 */
export const CHEQUE_ACCOUNTS = {
  BANK: '1010',
  RECEIVABLES: '1020',
  PAYABLES: '2010',
  NOTES_RECEIVABLE_IN_HAND: '1110',
  NOTES_RECEIVABLE_IN_COLLECTION: '1120',
  NOTES_PAYABLE: '2110',
} as const;

export const CHEQUE_ACCOUNT_DEFINITIONS = [
  { code: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_HAND, name: 'اسناد دریافتنی نزد صندوق', accountType: 'ASSET' },
  { code: CHEQUE_ACCOUNTS.NOTES_RECEIVABLE_IN_COLLECTION, name: 'اسناد دریافتنی در جریان وصول', accountType: 'ASSET' },
  { code: CHEQUE_ACCOUNTS.NOTES_PAYABLE, name: 'اسناد پرداختنی', accountType: 'LIABILITY' },
] as const;
