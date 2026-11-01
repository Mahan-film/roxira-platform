/**
 * ماهیت حساب‌ها در دفتر کل / Chart of Accounts.
 *
 * این مقادیر عیناً با نوع پایتونی/پایگاه‌داده `public.accounttype` منطبق‌اند
 * (جدول fin_chart_of_accounts). ستون مربوطه در TypeORM با
 * `enumName: 'accounttype'` نگاشت می‌شود.
 */
export enum AccountType {
  /** دارایی‌ها — ماهیت بدهکار */
  ASSET = 'ASSET',
  /** بدهی‌ها — ماهیت بستانکار */
  LIABILITY = 'LIABILITY',
  /** سرمایه و حقوق صاحبان سهام — ماهیت بستانکار */
  EQUITY = 'EQUITY',
  /** درآمدها — ماهیت بستانکار */
  REVENUE = 'REVENUE',
  /** هزینه‌ها — ماهیت بدهکار */
  EXPENSE = 'EXPENSE',
}

/**
 * وضعیت سند حسابداری در چرخه عمر دفتر روزنامه.
 *
 * POSTED:
 *   ثبت‌شده و نهایی؛ در گردش حساب‌ها و ترازنامه لحاظ می‌شود.
 * DRAFT:
 *   پیش‌نویس؛ هنوز نهایی نشده است، ممکن است ناتراز باشد و در هیچ گزارشی نمی‌آید.
 * TEMPORARY:
 *   موقت؛ تراز و بررسی‌شده اما هنوز قابل ویرایش و حذف است و در گزارش‌ها نمی‌آید.
 * VOID:
 *   ابطال‌شده؛ از محاسبات مالی حذف می‌شود.
 */
export enum JournalEntryStatus {
  POSTED = 'POSTED',
  DRAFT = 'DRAFT',
  TEMPORARY = 'TEMPORARY',
  VOID = 'VOID',
}

/**
 * حساب‌های با ماهیت بدهکار (افزایش آن‌ها با بدهکار و کاهش با بستانکار است).
 * سایر ماهیت‌ها (بدهی/سرمایه/درآمد) بستانکارمحور محسوب می‌شوند.
 */
export const DEBIT_NORMAL_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
  AccountType.ASSET,
  AccountType.EXPENSE,
]);

/** Depth of an account in the Iranian chart. GROUP and KOL are headers: nothing posts to them. */
export enum AccountLevel {
  GROUP = 'GROUP',
  KOL = 'KOL',
  MOEIN = 'MOEIN',
  TAFSILI = 'TAFSILI',
}

/**
 * Why an entry exists.
 *  - NORMAL: ordinary business entry.
 *  - OPENING: a user or import opening balance (counts as balance at the start of the period).
 *  - CLOSING_TEMP: moves revenue and expense through income summary into retained earnings.
 *  - CLOSING_PERM / OPENING_AUTO: the closing and opening pair of a fiscal close. They restate
 *    permanent balances across the year end and cancel each other, so reports exclude both.
 */
export enum JournalEntryType {
  NORMAL = 'NORMAL',
  OPENING = 'OPENING',
  CLOSING_TEMP = 'CLOSING_TEMP',
  CLOSING_PERM = 'CLOSING_PERM',
  OPENING_AUTO = 'OPENING_AUTO',
}

export enum FiscalYearStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/** Statement line an account reports on. */
export enum ReportLine {
  CASH = 'CASH',
  BANK = 'BANK',
  PETTY_CASH = 'PETTY_CASH',
  SHORT_TERM_INVESTMENT = 'SHORT_TERM_INVESTMENT',
  RECEIVABLE = 'RECEIVABLE',
  INVENTORY = 'INVENTORY',
  PREPAYMENT = 'PREPAYMENT',
  OTHER_CURRENT_ASSET = 'OTHER_CURRENT_ASSET',
  FIXED_ASSET = 'FIXED_ASSET',
  ACCUMULATED_DEPRECIATION = 'ACCUMULATED_DEPRECIATION',
  INTANGIBLE_ASSET = 'INTANGIBLE_ASSET',
  LONG_TERM_INVESTMENT = 'LONG_TERM_INVESTMENT',
  OTHER_NONCURRENT_ASSET = 'OTHER_NONCURRENT_ASSET',
  PAYABLE = 'PAYABLE',
  TAX_PAYABLE = 'TAX_PAYABLE',
  ADVANCE_RECEIVED = 'ADVANCE_RECEIVED',
  DIVIDEND_PAYABLE = 'DIVIDEND_PAYABLE',
  SHORT_TERM_LOAN = 'SHORT_TERM_LOAN',
  OTHER_CURRENT_LIABILITY = 'OTHER_CURRENT_LIABILITY',
  LONG_TERM_LOAN = 'LONG_TERM_LOAN',
  EMPLOYEE_BENEFITS = 'EMPLOYEE_BENEFITS',
  OTHER_NONCURRENT_LIABILITY = 'OTHER_NONCURRENT_LIABILITY',
  CAPITAL = 'CAPITAL',
  LEGAL_RESERVE = 'LEGAL_RESERVE',
  OTHER_RESERVE = 'OTHER_RESERVE',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  INCOME_SUMMARY = 'INCOME_SUMMARY',
  REVENUE = 'REVENUE',
  SALES_RETURNS = 'SALES_RETURNS',
  COGS = 'COGS',
  OPERATING_EXPENSE = 'OPERATING_EXPENSE',
  OTHER_OPERATING_INCOME = 'OTHER_OPERATING_INCOME',
  FINANCE_COST = 'FINANCE_COST',
  NON_OPERATING_INCOME = 'NON_OPERATING_INCOME',
  INCOME_TAX = 'INCOME_TAX',
}

export enum PettyCashFundStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

/** CHARGE fills the fund, RETURN gives cash back, EXPENSE is a receipt the custodian paid. */
export enum PettyCashKind {
  CHARGE = 'CHARGE',
  RETURN = 'RETURN',
  EXPENSE = 'EXPENSE',
}

/** An EXPENSE is PENDING until settled; CHARGE and RETURN post at once. */
export enum PettyCashStatus {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  POSTED = 'POSTED',
  VOID = 'VOID',
}

/** Floating detail (tafsili shenavar), cost centre and project centre share one table. */
export enum DimensionKind {
  DETAIL = 'DETAIL',
  COST_CENTER = 'COST_CENTER',
  PROJECT = 'PROJECT',
}
