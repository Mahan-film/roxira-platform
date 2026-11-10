import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';

export interface ChartTemplateAccount {
  code: string;
  name: string;
  accountType: AccountType;
  level: AccountLevel;
  parentCode: string | null;
  reportLine: ReportLine | null;
}

export interface ChartTemplate {
  key: string;
  name: string;
  description: string;
  accounts: readonly ChartTemplateAccount[];
}

const { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE } = AccountType;
const L = ReportLine;

/** [code, name, type, report line]. The parent of a moein is its first two digits. */
type Moein = [string, string, AccountType, ReportLine];

const GROUPS: ReadonlyArray<[string, string, AccountType]> = [
  ['1', 'دارایی‌ها', ASSET],
  ['2', 'بدهی‌ها', LIABILITY],
  ['3', 'حقوق مالکانه', EQUITY],
  ['4', 'درآمدها', REVENUE],
  ['5', 'بهای تمام‌شده و هزینه‌ها', EXPENSE],
];

const KOLS: ReadonlyArray<[string, string, AccountType]> = [
  ['10', 'دارایی‌های جاری', ASSET],
  ['11', 'دارایی‌های غیرجاری', ASSET],
  ['20', 'بدهی‌های جاری', LIABILITY],
  ['21', 'بدهی‌های غیرجاری', LIABILITY],
  ['30', 'حقوق مالکانه', EQUITY],
  ['40', 'فروش', REVENUE],
  ['41', 'سایر درآمدها', REVENUE],
  ['50', 'هزینه‌های عملیاتی', EXPENSE],
  ['51', 'بهای تمام‌شده', EXPENSE],
  ['52', 'هزینه‌های مالی و مالیات', EXPENSE],
];

/**
 * The codes the ledger and the other modules already post to keep their meaning here: 1010, 1020,
 * 1030, 2010, 2020, 3010, 4010, 4020, 5010, 5020, 5030 (default chart) and 2030, 2040, 2050, 2060,
 * 5040 (payroll). Changing one would move live postings to the wrong statement line.
 */
const COMMON_MOEINS: readonly Moein[] = [
  ['1010', 'موجودی نقد و بانک', ASSET, L.CASH],
  ['1011', 'صندوق', ASSET, L.CASH],
  ['1012', 'بانک‌ها', ASSET, L.BANK],
  ['1013', 'تنخواه‌گردان', ASSET, L.PETTY_CASH],
  ['1015', 'حساب واسط پوز', ASSET, L.CASH],
  ['1020', 'حساب‌های دریافتنی تجاری', ASSET, L.RECEIVABLE],
  ['1021', 'اسناد دریافتنی', ASSET, L.RECEIVABLE],
  ['1022', 'سایر دریافتنی‌ها', ASSET, L.RECEIVABLE],
  ['1025', 'ذخیره مطالبات مشکوک‌الوصول', ASSET, L.RECEIVABLE],
  ['1040', 'پیش‌پرداخت‌ها', ASSET, L.PREPAYMENT],
  ['1041', 'سرمایه‌گذاری‌های کوتاه‌مدت', ASSET, L.SHORT_TERM_INVESTMENT],
  ['1045', 'مالیات بر ارزش افزوده خرید', ASSET, L.OTHER_CURRENT_ASSET],
  ['1110', 'زمین', ASSET, L.FIXED_ASSET],
  ['1111', 'ساختمان', ASSET, L.FIXED_ASSET],
  ['1112', 'ماشین‌آلات و تجهیزات', ASSET, L.FIXED_ASSET],
  ['1113', 'اثاثه و منصوبات', ASSET, L.FIXED_ASSET],
  ['1114', 'وسایط نقلیه', ASSET, L.FIXED_ASSET],
  ['1120', 'استهلاک انباشته', ASSET, L.ACCUMULATED_DEPRECIATION],
  ['1130', 'دارایی‌های نامشهود', ASSET, L.INTANGIBLE_ASSET],
  ['1140', 'سرمایه‌گذاری‌های بلندمدت', ASSET, L.LONG_TERM_INVESTMENT],
  ['1150', 'سایر دارایی‌ها', ASSET, L.OTHER_NONCURRENT_ASSET],
  ['2010', 'حساب‌های پرداختنی تجاری', LIABILITY, L.PAYABLE],
  ['2011', 'اسناد پرداختنی', LIABILITY, L.PAYABLE],
  ['2012', 'سایر پرداختنی‌ها', LIABILITY, L.PAYABLE],
  ['2020', 'مالیات بر ارزش افزوده پرداختنی', LIABILITY, L.TAX_PAYABLE],
  ['2021', 'ذخیره مالیات عملکرد', LIABILITY, L.TAX_PAYABLE],
  ['2030', 'حق بیمه پرداختنی تأمین اجتماعی', LIABILITY, L.OTHER_CURRENT_LIABILITY],
  ['2040', 'مالیات حقوق پرداختنی', LIABILITY, L.TAX_PAYABLE],
  ['2050', 'حقوق و دستمزد پرداختنی', LIABILITY, L.OTHER_CURRENT_LIABILITY],
  ['2060', 'سایر کسورات حقوق پرداختنی', LIABILITY, L.OTHER_CURRENT_LIABILITY],
  ['2070', 'پیش‌دریافت‌ها', LIABILITY, L.ADVANCE_RECEIVED],
  ['2080', 'سود سهام پرداختنی', LIABILITY, L.DIVIDEND_PAYABLE],
  ['2090', 'تسهیلات مالی کوتاه‌مدت', LIABILITY, L.SHORT_TERM_LOAN],
  ['2110', 'تسهیلات مالی بلندمدت', LIABILITY, L.LONG_TERM_LOAN],
  ['2120', 'ذخیره مزایای پایان خدمت کارکنان', LIABILITY, L.EMPLOYEE_BENEFITS],
  ['3010', 'سرمایه', EQUITY, L.CAPITAL],
  ['3020', 'اندوخته قانونی', EQUITY, L.LEGAL_RESERVE],
  ['3030', 'سایر اندوخته‌ها', EQUITY, L.OTHER_RESERVE],
  ['3040', 'سود و زیان انباشته', EQUITY, L.RETAINED_EARNINGS],
  ['3050', 'خلاصه سود و زیان', EQUITY, L.INCOME_SUMMARY],
  ['4010', 'درآمد فروش خدمات', REVENUE, L.REVENUE],
  ['4030', 'برگشت از فروش و تخفیفات', REVENUE, L.SALES_RETURNS],
  ['4110', 'سایر درآمدهای عملیاتی', REVENUE, L.OTHER_OPERATING_INCOME],
  ['4120', 'درآمدهای غیرعملیاتی', REVENUE, L.NON_OPERATING_INCOME],
  ['4050', 'سود حاصل از فروش دارایی', REVENUE, L.OTHER_OPERATING_INCOME],
  ['5010', 'هزینه حقوق و دستمزد', EXPENSE, L.OPERATING_EXPENSE],
  ['5020', 'هزینه اجاره', EXPENSE, L.OPERATING_EXPENSE],
  ['5030', 'هزینه‌های عمومی و اداری', EXPENSE, L.OPERATING_EXPENSE],
  ['5040', 'هزینه بیمه سهم کارفرما و بیمه بیکاری', EXPENSE, L.OPERATING_EXPENSE],
  ['5050', 'هزینه‌های فروش و بازاریابی', EXPENSE, L.OPERATING_EXPENSE],
  ['5060', 'هزینه استهلاک', EXPENSE, L.OPERATING_EXPENSE],
  ['5070', 'زیان حاصل از فروش دارایی', EXPENSE, L.OPERATING_EXPENSE],
  ['5210', 'هزینه‌های مالی', EXPENSE, L.FINANCE_COST],
  ['5220', 'هزینه مالیات بر درآمد', EXPENSE, L.INCOME_TAX],
];

const TRADING_MOEINS: readonly Moein[] = [
  ['1030', 'موجودی کالا', ASSET, L.INVENTORY],
  ['4020', 'درآمد فروش کالا', REVENUE, L.REVENUE],
  ['5110', 'بهای تمام‌شده کالای فروش‌رفته', EXPENSE, L.COGS],
];

/** Example detail accounts. Parties (customers, suppliers) stay in `party_code` on the lines. */
const TAFSILIS: ReadonlyArray<[string, string, string, AccountType, ReportLine]> = [
  ['101101', 'صندوق مرکزی', '1011', ASSET, L.CASH],
  ['101301', 'تنخواه مرکزی', '1013', ASSET, L.PETTY_CASH],
];

function build(moeins: readonly Moein[]): ChartTemplateAccount[] {
  const usedKols = new Set(moeins.map(([code]) => code.slice(0, 2)));
  const kols = KOLS.filter(([code]) => usedKols.has(code));
  return [
    ...GROUPS.map(([code, name, accountType]) => ({
      code,
      name,
      accountType,
      level: AccountLevel.GROUP,
      parentCode: null,
      reportLine: null,
    })),
    ...kols.map(([code, name, accountType]) => ({
      code,
      name,
      accountType,
      level: AccountLevel.KOL,
      parentCode: code.slice(0, 1),
      reportLine: null,
    })),
    ...[...moeins]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, name, accountType, reportLine]) => ({
        code,
        name,
        accountType,
        level: AccountLevel.MOEIN,
        parentCode: code.slice(0, 2),
        reportLine,
      })),
    ...TAFSILIS.map(([code, name, parentCode, accountType, reportLine]) => ({
      code,
      name,
      accountType,
      level: AccountLevel.TAFSILI,
      parentCode,
      reportLine,
    })),
  ];
}

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  {
    key: 'iran-trading',
    name: 'شرکت بازرگانی',
    description: 'سرفصل استاندارد ایران با موجودی کالا و بهای تمام‌شده',
    accounts: build([...COMMON_MOEINS, ...TRADING_MOEINS]),
  },
  {
    key: 'iran-service',
    name: 'شرکت خدماتی',
    description: 'سرفصل استاندارد ایران بدون حساب‌های کالا',
    accounts: build(COMMON_MOEINS),
  },
];

/** Accounts a fiscal close needs; created on demand for charts without them. */
export const RETAINED_EARNINGS_ACCOUNT = { code: '3040', name: 'سود و زیان انباشته' };
export const INCOME_SUMMARY_ACCOUNT = { code: '3050', name: 'خلاصه سود و زیان' };
