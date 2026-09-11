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
 *   پیش‌نویس؛ هنوز نهایی نشده است.
 * VOID:
 *   ابطال‌شده؛ از محاسبات مالی حذف می‌شود.
 */
export enum JournalEntryStatus {
  POSTED = 'POSTED',
  DRAFT = 'DRAFT',
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