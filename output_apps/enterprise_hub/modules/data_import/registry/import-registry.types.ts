/**
 * انواع مشترک «رجیستری ورود داده» (Import Registry).
 *
 * هر موجودیت (سرنخ CRM، کارمند، کالا، حساب دفتر کل و ردیف افتتاحیه) یک فایل
 * رجیستری مستقل دارد که فیلدها، مترادف سربرگ‌ها، اعتبارسنجی و آداپتور درج/حذف
 * را توصیف می‌کند. لایه ورود داده فقط از طریق همین آداپتورها با ماژول‌های
 * مالک (CRM/HR/Inventory/Accounting) صحبت می‌کند و هرگز مستقیماً به جداول
 * آن‌ها دست نمی‌زند (Rule #1 و #3 - AGENTS.md).
 */

/** نوع داده فیلد قابل نگاشت (منطبق بر قرارداد مشترک فاز ۱). */
export type ImportFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'phone'
  | 'email'
  | 'money'
  | 'national_id'
  | 'enum';

/** توصیف یک فیلد قابل نگاشت در یک موجودیت. */
export interface ImportFieldDefinition {
  /** شناسه فیلد که در نگاشت ستون‌ها برگردانده می‌شود. */
  key: string;
  /** برچسب فارسی برای نمایش در ویزارد ورود داده. */
  labelFa: string;
  /** آیا این فیلد برای درج اجباری است؟ */
  required: boolean;
  /** نوع داده؛ مبنای نرمال‌سازی و اعتبارسنجی. */
  type: ImportFieldType;
  /** مقادیر مجاز برای فیلد `enum`. */
  enumValues?: readonly string[];
  /** مترادف‌های فارسی/انگلیسی مقدارهای enum (کلید → مقدار کانونی). */
  enumAliases?: Readonly<Record<string, string>>;
  /** مترادف‌های فارسی/انگلیسی سربرگ ستون. */
  synonyms: readonly string[];
}

/** یک ردیف نرمال‌شده و معتبرشده (مقدار کلیدها بر پایه نوع فیلد). */
export interface NormalisedRecord {
  /** شماره ردیف در فایل (سربرگ = ۱). */
  rowNumber: number;
  values: Record<string, unknown>;
}

/** نتیجه درج یک ردیف: شناسه ردیف در جدول ماژول مالک. */
export interface CommitRowResult {
  rowNumber: number;
  ownerId: number;
}

/** شکست درج یک ردیف در ماژول مالک. */
export interface AdapterRowFailure {
  rowNumber: number;
  message: string;
}

/** نتیجه درج آداپتور (ممکن است بخشی موفق و بخشی ناموفق باشد). */
export interface AdapterCommitResult {
  inserted: CommitRowResult[];
  failed: AdapterRowFailure[];
}

/** ردیفی که هنگام undo به‌دلیل ارجاع‌شدن حذف نمی‌شود. */
export interface RefusedRow {
  ownerId: number;
  message: string;
}

/** نتیجه undo یک موجودیت. */
export interface UndoOutcome {
  removed: number;
  refused: RefusedRow[];
}

/**
 * آداپتور یک موجودیت برای ورود داده.
 *
 * - `duplicateKeys`/`findExistingDuplicateKeys`: تشخیص تکراری مبتنی بر کلید
 *   طبیعی همان موجودیت (ایمیل/تلفن سرنخ، کد ملی کارمند، SKU کالا، کد حساب).
 * - `commit`: درج از طریق سرویس/ریپازیتوری ماژول مالک.
 * - `undo`: حذف دقیق ردیف‌های یک دسته و رد کردن ردیف‌های ارجاع‌شده.
 */
export interface EntityImportAdapter {
  readonly key: string;
  readonly labelFa: string;
  readonly fields: readonly ImportFieldDefinition[];
  duplicateKeys(record: NormalisedRecord): string[];
  findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]>;
  commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult>;
  undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome>;
}
