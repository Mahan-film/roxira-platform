import { AccountType } from '../enums/accounting.enum';

/** حداکثر تعداد سطرهای مجاز در یک سند حسابداری دوطرفه */
export const MAX_JOURNAL_LINES = 500;

/** حداکثر تعداد حساب‌های قابل بازگشت در فهرست دفتر کل */
export const MAX_CHART_OF_ACCOUNTS = 2000;

/** حداقل تعداد سطر برای یک سند حسابداری دوطرفه (حداقل یک بدهکار و یک بستانکار) */
export const MIN_JOURNAL_LINES = 2;

/** دقت ریالی مبالغ (تعداد ارقام اعشار) */
export const MONEY_SCALE = 2;

/**
 * آستانه تحمل اختلاف تراز سند (به دلیل محدودیت نمایش اعشاری اعداد اعشاری).
 * اگر قدرمطلق (جمع بدهکار − جمع بستانکار) از این مقدار کمتر باشد، سند تراز است.
 */
export const BALANCE_TOLERANCE = 0.01;

/** پیشوند پیشنهادی شماره سند حسابداری جهت تولید خودکار در کلاینت */
export const DEFAULT_JOURNAL_ENTRY_NUMBER_PREFIX = 'JV';

/**
 * دفتر کل پیش‌فرض که برای هر مستأجر جدید در نخستین استفاده به‌صورت تنبل
 * (lazy) بذرگذاری می‌شود.
 *
 * پیش‌تر این حساب‌ها یک بار و به‌صورت سراسری در Migration
 * `1789050000000-CreateJournalEntryLinesTable` درج می‌شدند که با مدل
 * چند‌مستأجری ناسازگار است؛ اکنون هر سازمان دفتر کل اختصاصی خود را دارد
 * (Rule #4 - AGENTS.md) و کد حساب فقط در محدوده همان مستأجر یکتاست.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ReadonlyArray<{
  code: string;
  name: string;
  accountType: AccountType;
}> = [
  { code: '1010', name: 'موجودی نقد و بانک', accountType: AccountType.ASSET },
  {
    code: '1020',
    name: 'حساب‌های دریافتنی تجاری',
    accountType: AccountType.ASSET,
  },
  { code: '1030', name: 'موجودی کالا', accountType: AccountType.ASSET },
  {
    code: '2010',
    name: 'حساب‌های پرداختنی تجاری',
    accountType: AccountType.LIABILITY,
  },
  {
    code: '2020',
    name: 'مالیات بر ارزش افزوده پرداختنی',
    accountType: AccountType.LIABILITY,
  },
  { code: '3010', name: 'سرمایه', accountType: AccountType.EQUITY },
  {
    code: '4010',
    name: 'درآمد فروش خدمات',
    accountType: AccountType.REVENUE,
  },
  { code: '4020', name: 'درآمد فروش کالا', accountType: AccountType.REVENUE },
  {
    code: '5010',
    name: 'هزینه حقوق و دستمزد',
    accountType: AccountType.EXPENSE,
  },
  { code: '5020', name: 'هزینه اجاره', accountType: AccountType.EXPENSE },
  {
    code: '5030',
    name: 'هزینه‌های عمومی و اداری',
    accountType: AccountType.EXPENSE,
  },
];