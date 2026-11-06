import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';

export interface ChartTemplateAccount {
  code: string;
  name: string;
  accountType: AccountType;
  level: AccountLevel;
  parentCode: string | null;
  reportLine: ReportLine | null;
  /**
   * Kol of the standard Iranian chart this account reports under (tax ledger export), from
   * docs/accounting/research/CHART_AND_POSTING_STANDARD.md. UNVERIFIED against the Audit Organization
   * text: confirm with an accountant before an export relies on it. Null on group and kol rows and
   * where the standard kol is unclear.
   */
  standardKolCode: string | null;
  /** Contra account: its balance reduces the line it sits on (allowance, accumulated depreciation, returns). */
  contra: boolean;
}

export interface ChartTemplate {
  key: string;
  name: string;
  description: string;
  accounts: readonly ChartTemplateAccount[];
}

const { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE } = AccountType;
const L = ReportLine;

/**
 * [code, name, type, report line, standard kol (unverified), contra]. The parent of a moein is its
 * first two digits.
 */
type Moein = [string, string, AccountType, ReportLine, string | null, boolean?];
const CONTRA = true;

const GROUPS: ReadonlyArray<[string, string, AccountType]> = [
  ['1', 'دارایی‌ها', ASSET],
  ['2', 'بدهی‌ها', LIABILITY],
  ['3', 'حقوق مالکانه', EQUITY],
  ['4', 'درآمدها', REVENUE],
  ['5', 'بهای تمام‌شده و هزینه‌ها', EXPENSE],
  // Memorandum (off-balance) accounts: each 91 debit has a 92 credit, so they net to zero and stay
  // off the statements (report line MEMORANDUM). Typed ASSET / LIABILITY only for the debit/credit nature.
  ['9', 'حساب‌های انتظامی', ASSET],
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
  ['91', 'حساب‌های انتظامی', ASSET],
  ['92', 'طرف حساب‌های انتظامی', LIABILITY],
];

/**
 * The codes the ledger and the other modules already post to keep their meaning here: 1010, 1020,
 * 1030, 2010, 2020, 3010, 4010, 4020, 5010, 5020, 5030 (default chart) and 2030, 2040, 2050, 2060,
 * 5040 (payroll). Changing one would move live postings to the wrong statement line.
 *
 * Cheques post to 1021 (notes receivable in hand), 1023 (notes receivable in collection) and 2011
 * (notes payable). 1110, 1120 and 2110 are land, accumulated depreciation and long-term loans: never
 * post cheques there (#267).
 */
const COMMON_MOEINS: readonly Moein[] = [
  ['1010', 'موجودی نقد و بانک', ASSET, L.CASH, '11'],
  ['1011', 'صندوق', ASSET, L.CASH, '11'],
  ['1012', 'بانک‌ها', ASSET, L.BANK, '11'],
  ['1013', 'تنخواه‌گردان', ASSET, L.PETTY_CASH, '11'],
  ['1020', 'حساب‌های دریافتنی تجاری', ASSET, L.RECEIVABLE, '14'],
  ['1021', 'اسناد دریافتنی', ASSET, L.RECEIVABLE, '14'],
  ['1022', 'سایر دریافتنی‌ها', ASSET, L.RECEIVABLE, '15'],
  ['1023', 'اسناد دریافتنی در جریان وصول', ASSET, L.RECEIVABLE, '14'],
  ['1025', 'ذخیره مطالبات مشکوک‌الوصول', ASSET, L.RECEIVABLE, '14', CONTRA],
  ['1040', 'پیش‌پرداخت‌ها', ASSET, L.PREPAYMENT, '18'],
  ['1041', 'سرمایه‌گذاری‌های کوتاه‌مدت', ASSET, L.SHORT_TERM_INVESTMENT, '12'],
  ['1045', 'مالیات بر ارزش افزوده خرید', ASSET, L.OTHER_CURRENT_ASSET, '15'],
  ['1110', 'زمین', ASSET, L.FIXED_ASSET, '25'],
  ['1111', 'ساختمان', ASSET, L.FIXED_ASSET, '25'],
  ['1112', 'ماشین‌آلات و تجهیزات', ASSET, L.FIXED_ASSET, '25'],
  ['1113', 'اثاثه و منصوبات', ASSET, L.FIXED_ASSET, '25'],
  ['1114', 'وسایط نقلیه', ASSET, L.FIXED_ASSET, '25'],
  ['1120', 'استهلاک انباشته', ASSET, L.ACCUMULATED_DEPRECIATION, '25', CONTRA],
  ['1130', 'دارایی‌های نامشهود', ASSET, L.INTANGIBLE_ASSET, '24'],
  ['1140', 'سرمایه‌گذاری‌های بلندمدت', ASSET, L.LONG_TERM_INVESTMENT, '22'],
  ['1150', 'سایر دارایی‌ها', ASSET, L.OTHER_NONCURRENT_ASSET, '26'],
  ['2010', 'حساب‌های پرداختنی تجاری', LIABILITY, L.PAYABLE, '32'],
  ['2011', 'اسناد پرداختنی', LIABILITY, L.PAYABLE, '31'],
  ['2012', 'سایر پرداختنی‌ها', LIABILITY, L.PAYABLE, '33'],
  ['2020', 'مالیات بر ارزش افزوده پرداختنی', LIABILITY, L.TAX_PAYABLE, '34'],
  ['2021', 'ذخیره مالیات عملکرد', LIABILITY, L.TAX_PAYABLE, '34'],
  ['2030', 'حق بیمه پرداختنی تأمین اجتماعی', LIABILITY, L.OTHER_CURRENT_LIABILITY, '33'],
  ['2040', 'مالیات حقوق پرداختنی', LIABILITY, L.TAX_PAYABLE, '34'],
  ['2050', 'حقوق و دستمزد پرداختنی', LIABILITY, L.OTHER_CURRENT_LIABILITY, '33'],
  ['2060', 'سایر کسورات حقوق پرداختنی', LIABILITY, L.OTHER_CURRENT_LIABILITY, '33'],
  ['2070', 'پیش‌دریافت‌ها', LIABILITY, L.ADVANCE_RECEIVED, '38'],
  ['2080', 'سود سهام پرداختنی', LIABILITY, L.DIVIDEND_PAYABLE, '35'],
  ['2090', 'تسهیلات مالی کوتاه‌مدت', LIABILITY, L.SHORT_TERM_LOAN, '36'],
  ['2110', 'تسهیلات مالی بلندمدت', LIABILITY, L.LONG_TERM_LOAN, '45'],
  ['2120', 'ذخیره مزایای پایان خدمت کارکنان', LIABILITY, L.EMPLOYEE_BENEFITS, '46'],
  ['3010', 'سرمایه', EQUITY, L.CAPITAL, '51'],
  ['3020', 'اندوخته قانونی', EQUITY, L.LEGAL_RESERVE, '54'],
  ['3030', 'سایر اندوخته‌ها', EQUITY, L.OTHER_RESERVE, '55'],
  ['3040', 'سود و زیان انباشته', EQUITY, L.RETAINED_EARNINGS, '58'],
  ['3050', 'خلاصه سود و زیان', EQUITY, L.INCOME_SUMMARY, '59'],
  ['3060', 'افزایش سرمایه در جریان', EQUITY, L.CAPITAL, '52'],
  ['3070', 'صرف سهام', EQUITY, L.CAPITAL, '53'],
  ['3080', 'مازاد تجدید ارزیابی دارایی‌ها', EQUITY, L.OTHER_RESERVE, '56'],
  ['3090', 'تفاوت تسعیر ارز', EQUITY, L.OTHER_RESERVE, '57'],
  ['4010', 'درآمد فروش خدمات', REVENUE, L.REVENUE, '61'],
  ['4030', 'برگشت از فروش و تخفیفات', REVENUE, L.SALES_RETURNS, '61', CONTRA],
  ['4110', 'سایر درآمدهای عملیاتی', REVENUE, L.OTHER_OPERATING_INCOME, '62'],
  ['4120', 'درآمدهای غیرعملیاتی', REVENUE, L.NON_OPERATING_INCOME, null],
  ['5010', 'هزینه حقوق و دستمزد', EXPENSE, L.OPERATING_EXPENSE, '71'],
  ['5020', 'هزینه اجاره', EXPENSE, L.OPERATING_EXPENSE, '72'],
  ['5030', 'هزینه‌های عمومی و اداری', EXPENSE, L.OPERATING_EXPENSE, '72'],
  ['5040', 'هزینه بیمه سهم کارفرما و بیمه بیکاری', EXPENSE, L.OPERATING_EXPENSE, '71'],
  ['5050', 'هزینه‌های فروش و بازاریابی', EXPENSE, L.OPERATING_EXPENSE, '73'],
  ['5060', 'هزینه استهلاک', EXPENSE, L.OPERATING_EXPENSE, '72'],
  ['5210', 'هزینه‌های مالی', EXPENSE, L.FINANCE_COST, '75'],
  ['5220', 'هزینه مالیات بر درآمد', EXPENSE, L.INCOME_TAX, null],
  ['9110', 'حساب‌های انتظامی', ASSET, L.MEMORANDUM, '91'],
  ['9210', 'طرف حساب‌های انتظامی', LIABILITY, L.MEMORANDUM, '92'],
];

const TRADING_MOEINS: readonly Moein[] = [
  ['1030', 'موجودی کالا', ASSET, L.INVENTORY, '16'],
  ['4020', 'درآمد فروش کالا', REVENUE, L.REVENUE, '61'],
  ['5110', 'بهای تمام‌شده کالای فروش‌رفته', EXPENSE, L.COGS, '81'],
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
      standardKolCode: null,
      contra: false,
    })),
    ...kols.map(([code, name, accountType]) => ({
      code,
      name,
      accountType,
      level: AccountLevel.KOL,
      parentCode: code.slice(0, 1),
      reportLine: null,
      standardKolCode: null,
      contra: false,
    })),
    ...[...moeins]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, name, accountType, reportLine, standardKolCode, contra = false]) => ({
        code,
        name,
        accountType,
        level: AccountLevel.MOEIN,
        parentCode: code.slice(0, 2),
        reportLine,
        standardKolCode,
        contra,
      })),
    ...TAFSILIS.map(([code, name, parentCode, accountType, reportLine]) => ({
      code,
      name,
      accountType,
      level: AccountLevel.TAFSILI,
      parentCode,
      reportLine,
      // A tafsili reports under its moein's standard kol.
      standardKolCode: moeins.find(([moein]) => moein === parentCode)?.[4] ?? null,
      contra: false,
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
