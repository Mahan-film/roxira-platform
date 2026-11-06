/**
 * Pure report arithmetic: account buckets in, trial balance and statements out. Everything is in
 * integer minor units (bigint). `net` values are debit-positive, statement amounts carry their
 * natural sign (an asset or an expense is positive when debit, the rest when credit).
 */
import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';

const L = ReportLine;

export interface ReportAccount {
  id: number;
  code: string;
  name: string;
  accountType: AccountType;
  level: AccountLevel | null;
  parentCode: string | null;
  reportLine: ReportLine | null;
}

export interface AccountBalance {
  account: ReportAccount;
  line: ReportLine;
  /** Not set on the account: taken from its name and type. */
  inferred: boolean;
  /** Net balance before the year and openings. */
  opening: bigint;
  priorDebit: bigint;
  priorCredit: bigint;
  periodDebit: bigint;
  periodCredit: bigint;
  /** Income summary and retained earnings transfers of a close. */
  closeDebit: bigint;
  closeCredit: bigint;
}

const prior = (b: AccountBalance): bigint => b.priorDebit - b.priorCredit;
const period = (b: AccountBalance): bigint => b.periodDebit - b.periodCredit;
const close = (b: AccountBalance): bigint => b.closeDebit - b.closeCredit;
/** Debit-positive balance at the end of the period, with closing transfers. */
const ending = (b: AccountBalance): bigint => b.opening + prior(b) + period(b) + close(b);

const has = (name: string, pattern: RegExp): boolean => pattern.test(name);

/** Statement line of an account: the one set on it, else inferred from its name and type. */
export function classify(account: ReportAccount): { line: ReportLine; inferred: boolean } {
  if (account.reportLine) {
    return { line: account.reportLine, inferred: false };
  }
  const name = account.name;
  const pick = (): ReportLine => {
    switch (account.accountType) {
      case AccountType.ASSET:
        if (has(name, /تنخواه/)) return L.PETTY_CASH;
        if (has(name, /استهلاک/)) return L.ACCUMULATED_DEPRECIATION;
        if (has(name, /نقد|صندوق/)) return L.CASH;
        if (has(name, /بانک|سپرده/)) return L.BANK;
        if (has(name, /دریافتنی|بدهکاران|مشتریان/)) return L.RECEIVABLE;
        if (has(name, /پیش.?پرداخت/)) return L.PREPAYMENT;
        if (has(name, /کالا|انبار|موجودی/)) return L.INVENTORY;
        if (has(name, /زمین|ساختمان|ماشین|اثاثه|وسایط|تجهیزات|ثابت/)) return L.FIXED_ASSET;
        if (has(name, /نامشهود|سرقفلی/)) return L.INTANGIBLE_ASSET;
        if (has(name, /بلندمدت/)) return L.LONG_TERM_INVESTMENT;
        return L.OTHER_CURRENT_ASSET;
      case AccountType.LIABILITY:
        if (has(name, /پیش.?دریافت/)) return L.ADVANCE_RECEIVED;
        if (has(name, /سود سهام/)) return L.DIVIDEND_PAYABLE;
        if (has(name, /تسهیلات|وام/)) return has(name, /بلندمدت/) ? L.LONG_TERM_LOAN : L.SHORT_TERM_LOAN;
        if (has(name, /پایان خدمت|بازخرید/)) return L.EMPLOYEE_BENEFITS;
        if (has(name, /مالیات|عوارض/)) return L.TAX_PAYABLE;
        if (has(name, /پرداختنی|بستانکاران|تامین|تأمین/)) return L.PAYABLE;
        return L.OTHER_CURRENT_LIABILITY;
      case AccountType.EQUITY:
        if (has(name, /خلاصه سود/)) return L.INCOME_SUMMARY;
        if (has(name, /اندوخته قانونی/)) return L.LEGAL_RESERVE;
        if (has(name, /اندوخته/)) return L.OTHER_RESERVE;
        if (has(name, /سرمایه/)) return L.CAPITAL;
        return L.RETAINED_EARNINGS;
      case AccountType.REVENUE:
        if (has(name, /برگشت|تخفیف/)) return L.SALES_RETURNS;
        if (has(name, /غیرعملیاتی|غیر عملیاتی|سود سپرده|سود بانکی/)) return L.NON_OPERATING_INCOME;
        return L.REVENUE;
      default:
        if (has(name, /بهای تمام|قیمت تمام/)) return L.COGS;
        if (has(name, /مالیات بر درآمد|مالیات عملکرد/)) return L.INCOME_TAX;
        if (has(name, /غیرعملیاتی|غیر عملیاتی/)) return L.NON_OPERATING_INCOME;
        if (has(name, /مالی|کارمزد بانک|سود تسهیلات/)) return L.FINANCE_COST;
        return L.OPERATING_EXPENSE;
    }
  };
  return { line: pick(), inferred: true };
}

export const LINE_TITLES: Readonly<Record<ReportLine, string>> = {
  [L.CASH]: 'صندوق و نقد',
  [L.BANK]: 'موجودی نزد بانک‌ها',
  [L.PETTY_CASH]: 'تنخواه‌گردان',
  [L.SHORT_TERM_INVESTMENT]: 'سرمایه‌گذاری‌های کوتاه‌مدت',
  [L.RECEIVABLE]: 'دریافتنی‌های تجاری و سایر دریافتنی‌ها',
  [L.INVENTORY]: 'موجودی مواد و کالا',
  [L.PREPAYMENT]: 'پیش‌پرداخت‌ها',
  [L.OTHER_CURRENT_ASSET]: 'سایر دارایی‌های جاری',
  [L.FIXED_ASSET]: 'دارایی‌های ثابت مشهود',
  [L.ACCUMULATED_DEPRECIATION]: 'استهلاک انباشته',
  [L.INTANGIBLE_ASSET]: 'دارایی‌های نامشهود',
  [L.LONG_TERM_INVESTMENT]: 'سرمایه‌گذاری‌های بلندمدت',
  [L.OTHER_NONCURRENT_ASSET]: 'سایر دارایی‌ها',
  [L.PAYABLE]: 'پرداختنی‌های تجاری و سایر پرداختنی‌ها',
  [L.TAX_PAYABLE]: 'مالیات پرداختنی',
  [L.ADVANCE_RECEIVED]: 'پیش‌دریافت‌ها',
  [L.DIVIDEND_PAYABLE]: 'سود سهام پرداختنی',
  [L.SHORT_TERM_LOAN]: 'تسهیلات مالی جاری',
  [L.OTHER_CURRENT_LIABILITY]: 'سایر بدهی‌های جاری',
  [L.LONG_TERM_LOAN]: 'تسهیلات مالی بلندمدت',
  [L.EMPLOYEE_BENEFITS]: 'ذخیره مزایای پایان خدمت کارکنان',
  [L.OTHER_NONCURRENT_LIABILITY]: 'سایر بدهی‌های غیرجاری',
  [L.CAPITAL]: 'سرمایه',
  [L.LEGAL_RESERVE]: 'اندوخته قانونی',
  [L.OTHER_RESERVE]: 'سایر اندوخته‌ها',
  [L.RETAINED_EARNINGS]: 'سود (زیان) انباشته',
  [L.INCOME_SUMMARY]: 'خلاصه سود و زیان',
  [L.REVENUE]: 'درآمدهای عملیاتی',
  [L.SALES_RETURNS]: 'برگشت از فروش و تخفیفات',
  [L.COGS]: 'بهای تمام‌شده درآمدهای عملیاتی',
  [L.OPERATING_EXPENSE]: 'هزینه‌های فروش، اداری و عمومی',
  [L.OTHER_OPERATING_INCOME]: 'سایر درآمدهای عملیاتی',
  [L.FINANCE_COST]: 'هزینه‌های مالی',
  [L.NON_OPERATING_INCOME]: 'سایر درآمدها و هزینه‌های غیرعملیاتی',
  [L.INCOME_TAX]: 'هزینه مالیات بر درآمد',
  [L.MEMORANDUM]: 'حساب‌های انتظامی',
};

const CURRENT_ASSETS = [L.CASH, L.BANK, L.PETTY_CASH, L.SHORT_TERM_INVESTMENT, L.RECEIVABLE, L.INVENTORY, L.PREPAYMENT, L.OTHER_CURRENT_ASSET];
const NONCURRENT_ASSETS = [L.FIXED_ASSET, L.ACCUMULATED_DEPRECIATION, L.INTANGIBLE_ASSET, L.LONG_TERM_INVESTMENT, L.OTHER_NONCURRENT_ASSET];
const CURRENT_LIABILITIES = [L.PAYABLE, L.TAX_PAYABLE, L.ADVANCE_RECEIVED, L.DIVIDEND_PAYABLE, L.SHORT_TERM_LOAN, L.OTHER_CURRENT_LIABILITY];
const NONCURRENT_LIABILITIES = [L.LONG_TERM_LOAN, L.EMPLOYEE_BENEFITS, L.OTHER_NONCURRENT_LIABILITY];
const EQUITY_LINES = [L.CAPITAL, L.LEGAL_RESERVE, L.OTHER_RESERVE, L.RETAINED_EARNINGS, L.INCOME_SUMMARY];
const INCOME_LINES = [L.REVENUE, L.SALES_RETURNS, L.COGS, L.OPERATING_EXPENSE, L.OTHER_OPERATING_INCOME, L.FINANCE_COST, L.NON_OPERATING_INCOME, L.INCOME_TAX];
const CASH_LINES = [L.CASH, L.BANK, L.PETTY_CASH];

export interface StatementAccount {
  code: string;
  name: string;
  amount: bigint;
}

export interface StatementLine {
  line: string;
  title: string;
  amount: bigint;
  accounts: StatementAccount[];
}

export interface StatementSection {
  key: string;
  title: string;
  lines: StatementLine[];
  total: bigint;
}

export interface ReconciliationCheck {
  key: string;
  title: string;
  left: bigint;
  right: bigint;
  ok: boolean;
}

const check = (key: string, title: string, left: bigint, right: bigint): ReconciliationCheck => ({
  key,
  title,
  left,
  right,
  ok: left === right,
});

const sum = (items: AccountBalance[], value: (b: AccountBalance) => bigint): bigint =>
  items.reduce((total, item) => total + value(item), 0n);

/** One line per statement line with a non-zero amount, in the given order. */
function statementLines(
  balances: AccountBalance[],
  lines: readonly ReportLine[],
  amount: (b: AccountBalance) => bigint,
): StatementLine[] {
  return lines.flatMap((line) => {
    const members = balances.filter((b) => b.line === line);
    const accounts = members
      .map((b) => ({ code: b.account.code, name: b.account.name, amount: amount(b) }))
      .filter((a) => a.amount !== 0n);
    if (accounts.length === 0) {
      return [];
    }
    return [{
      line,
      title: LINE_TITLES[line],
      amount: accounts.reduce((total, a) => total + a.amount, 0n),
      accounts,
    }];
  });
}

const section = (key: string, title: string, lines: StatementLine[]): StatementSection => ({
  key,
  title,
  lines,
  total: lines.reduce((total, line) => total + line.amount, 0n),
});

export interface IncomeStatement {
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: bigint;
  operatingExpenses: StatementSection;
  otherOperatingIncome: StatementSection;
  operatingProfit: bigint;
  financeCosts: StatementSection;
  nonOperating: StatementSection;
  profitBeforeTax: bigint;
  incomeTax: StatementSection;
  netProfit: bigint;
}

/** Period activity, closing transfers excluded. */
export function incomeStatement(balances: AccountBalance[]): IncomeStatement {
  const credit = (b: AccountBalance): bigint => -period(b);
  const debit = (b: AccountBalance): bigint => period(b);
  const revenue = section('revenue', 'درآمدهای عملیاتی', statementLines(balances, [L.REVENUE, L.SALES_RETURNS], credit));
  const costOfSales = section('costOfSales', 'بهای تمام‌شده', statementLines(balances, [L.COGS], debit));
  const operatingExpenses = section('operatingExpenses', 'هزینه‌های عملیاتی', statementLines(balances, [L.OPERATING_EXPENSE], debit));
  const otherOperatingIncome = section('otherOperatingIncome', 'سایر درآمدهای عملیاتی', statementLines(balances, [L.OTHER_OPERATING_INCOME], credit));
  const financeCosts = section('financeCosts', 'هزینه‌های مالی', statementLines(balances, [L.FINANCE_COST], debit));
  const nonOperating = section('nonOperating', 'غیرعملیاتی', statementLines(balances, [L.NON_OPERATING_INCOME], credit));
  const incomeTax = section('incomeTax', 'مالیات بر درآمد', statementLines(balances, [L.INCOME_TAX], debit));
  const grossProfit = revenue.total - costOfSales.total;
  const operatingProfit = grossProfit - operatingExpenses.total + otherOperatingIncome.total;
  const profitBeforeTax = operatingProfit - financeCosts.total + nonOperating.total;
  return {
    revenue,
    costOfSales,
    grossProfit,
    operatingExpenses,
    otherOperatingIncome,
    operatingProfit,
    financeCosts,
    nonOperating,
    profitBeforeTax,
    incomeTax,
    netProfit: profitBeforeTax - incomeTax.total,
  };
}

const isIncome = (b: AccountBalance): boolean => INCOME_LINES.includes(b.line);

export interface BalanceSheet {
  currentAssets: StatementSection;
  nonCurrentAssets: StatementSection;
  totalAssets: bigint;
  currentLiabilities: StatementSection;
  nonCurrentLiabilities: StatementSection;
  totalLiabilities: bigint;
  equity: StatementSection;
  totalEquity: bigint;
  totalLiabilitiesAndEquity: bigint;
  checks: ReconciliationCheck[];
}

/** Revenue and expense not yet closed, credit-positive: the part of equity still in temporary accounts. */
function unclosedEarnings(balances: AccountBalance[]): { current: bigint; earlier: bigint } {
  const income = balances.filter(isIncome);
  const earlier = -sum(income, (b) => b.opening + prior(b));
  const current = -sum(income, (b) => period(b) + close(b));
  // A close sweeps earlier unclosed earnings too: after it the two offset and nothing is left.
  return earlier + current === 0n ? { current: 0n, earlier: 0n } : { current, earlier };
}

/** Position at the end of the period. Assets = liabilities + equity is proved from the buckets. */
export function balanceSheet(balances: AccountBalance[]): BalanceSheet {
  const debit = ending;
  const credit = (b: AccountBalance): bigint => -ending(b);
  const currentAssets = section('currentAssets', 'دارایی‌های جاری', statementLines(balances, CURRENT_ASSETS, debit));
  const nonCurrentAssets = section('nonCurrentAssets', 'دارایی‌های غیرجاری', statementLines(balances, NONCURRENT_ASSETS, debit));
  const currentLiabilities = section('currentLiabilities', 'بدهی‌های جاری', statementLines(balances, CURRENT_LIABILITIES, credit));
  const nonCurrentLiabilities = section('nonCurrentLiabilities', 'بدهی‌های غیرجاری', statementLines(balances, NONCURRENT_LIABILITIES, credit));
  const { current, earlier } = unclosedEarnings(balances);
  const earningsLine = (line: string, title: string, amount: bigint): StatementLine[] =>
    amount === 0n ? [] : [{ line, title, amount, accounts: [] }];
  const equity = section('equity', 'حقوق مالکانه', [
    ...statementLines(balances, EQUITY_LINES, credit),
    ...earningsLine('EARLIER_EARNINGS', 'سود (زیان) دوره‌های قبل بسته‌نشده', earlier),
    ...earningsLine('PERIOD_EARNINGS', 'سود (زیان) دوره', current),
  ]);
  const totalAssets = currentAssets.total + nonCurrentAssets.total;
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  const totalLiabilitiesAndEquity = totalLiabilities + equity.total;
  return {
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    equity,
    totalEquity: equity.total,
    totalLiabilitiesAndEquity,
    checks: [
      check('balance_sheet', 'دارایی‌ها = بدهی‌ها + حقوق مالکانه', totalAssets, totalLiabilitiesAndEquity),
      check('accounts_net_zero', 'جمع مانده همه حساب‌ها صفر است', sum(balances, ending), 0n),
    ],
  };
}

export interface CashFlowStatement {
  netProfit: bigint;
  operating: StatementSection;
  operatingCash: bigint;
  investing: StatementSection;
  financing: StatementSection;
  netChange: bigint;
  openingCash: bigint;
  closingCash: bigint;
  checks: ReconciliationCheck[];
}

/**
 * Indirect method: net profit plus the change in every non-cash balance. Each posted entry balances,
 * so the sections add up to the change in cash exactly, not by a plug.
 */
export function cashFlow(balances: AccountBalance[]): CashFlowStatement {
  const change = (b: AccountBalance): bigint => -period(b);
  const netProfit = incomeStatement(balances).netProfit;
  const operating = section('operating', 'فعالیت‌های عملیاتی', statementLines(balances, [
    L.ACCUMULATED_DEPRECIATION, L.RECEIVABLE, L.INVENTORY, L.PREPAYMENT, L.OTHER_CURRENT_ASSET,
    L.PAYABLE, L.TAX_PAYABLE, L.ADVANCE_RECEIVED, L.OTHER_CURRENT_LIABILITY, L.EMPLOYEE_BENEFITS,
    L.OTHER_NONCURRENT_LIABILITY,
  ], change));
  const investing = section('investing', 'فعالیت‌های سرمایه‌گذاری', statementLines(balances, [
    L.SHORT_TERM_INVESTMENT, L.FIXED_ASSET, L.INTANGIBLE_ASSET, L.LONG_TERM_INVESTMENT, L.OTHER_NONCURRENT_ASSET,
  ], change));
  const financing = section('financing', 'فعالیت‌های تأمین مالی', statementLines(balances, [
    L.SHORT_TERM_LOAN, L.LONG_TERM_LOAN, L.DIVIDEND_PAYABLE, ...EQUITY_LINES,
  ], change));
  const operatingCash = netProfit + operating.total;
  const netChange = operatingCash + investing.total + financing.total;
  const cash = balances.filter((b) => CASH_LINES.includes(b.line));
  const openingCash = sum(cash, (b) => b.opening + prior(b));
  const closingCash = sum(cash, ending);
  return {
    netProfit,
    operating,
    operatingCash,
    investing,
    financing,
    netChange,
    openingCash,
    closingCash,
    checks: [check('cash_flow', 'خالص جریان نقد = تغییر موجودی نقد', openingCash + netChange, closingCash)],
  };
}

export interface EquityRow {
  key: string;
  title: string;
  capital: bigint;
  legalReserve: bigint;
  otherReserves: bigint;
  retainedEarnings: bigint;
  total: bigint;
}

export interface EquityChanges {
  rows: EquityRow[];
  checks: ReconciliationCheck[];
}

const EQUITY_COLUMNS = {
  capital: [L.CAPITAL],
  legalReserve: [L.LEGAL_RESERVE],
  otherReserves: [L.OTHER_RESERVE],
  retainedEarnings: [L.RETAINED_EARNINGS, L.INCOME_SUMMARY],
} as const;

/** Opening + period profit + direct equity movements = closing, per column. */
export function equityChanges(balances: AccountBalance[]): EquityChanges {
  const row = (
    key: string,
    title: string,
    value: (lines: readonly ReportLine[]) => bigint,
    extraRetained = 0n,
  ): EquityRow => {
    const capital = value(EQUITY_COLUMNS.capital);
    const legalReserve = value(EQUITY_COLUMNS.legalReserve);
    const otherReserves = value(EQUITY_COLUMNS.otherReserves);
    const retainedEarnings = value(EQUITY_COLUMNS.retainedEarnings) + extraRetained;
    return {
      key,
      title,
      capital,
      legalReserve,
      otherReserves,
      retainedEarnings,
      total: capital + legalReserve + otherReserves + retainedEarnings,
    };
  };
  const of = (lines: readonly ReportLine[], value: (b: AccountBalance) => bigint): bigint =>
    sum(balances.filter((b) => lines.includes(b.line)), value);
  const income = balances.filter(isIncome);
  const openingIncome = -sum(income, (b) => b.opening + prior(b));
  const netProfit = incomeStatement(balances).netProfit;
  const rows = [
    row('opening', 'مانده ابتدای دوره', (lines) => -of(lines, (b) => b.opening + prior(b)), openingIncome),
    row('netProfit', 'سود (زیان) خالص دوره', () => 0n, netProfit),
    row('movements', 'افزایش سرمایه، تقسیم سود و سایر تغییرات', (lines) => -of(lines, period)),
  ];
  const closing = row('closing', 'مانده پایان دوره', (lines) =>
    rows.reduce((total, current) => {
      const key = (Object.keys(EQUITY_COLUMNS) as Array<keyof typeof EQUITY_COLUMNS>).find(
        (candidate) => EQUITY_COLUMNS[candidate] === lines,
      )!;
      return total + current[key];
    }, 0n),
  );
  const sheet = balanceSheet(balances);
  return {
    rows: [...rows, closing],
    checks: [check('equity', 'پایان دوره = حقوق مالکانه ترازنامه', closing.total, sheet.totalEquity)],
  };
}

export type TrialBalanceColumns = 2 | 4 | 6 | 8 | 10;

export interface TrialBalanceRow {
  code: string;
  name: string;
  level: AccountLevel | null;
  /** Debit and credit of each group; a report shows the groups of its column count. */
  openingDebit: bigint;
  openingCredit: bigint;
  priorDebit: bigint;
  priorCredit: bigint;
  periodDebit: bigint;
  periodCredit: bigint;
  turnoverDebit: bigint;
  turnoverCredit: bigint;
  endingDebit: bigint;
  endingCredit: bigint;
}

export type TrialBalanceGroup = 'opening' | 'prior' | 'period' | 'turnover' | 'ending';

export const TRIAL_BALANCE_GROUPS: Readonly<Record<TrialBalanceColumns, readonly TrialBalanceGroup[]>> = {
  2: ['ending'],
  4: ['period', 'ending'],
  6: ['opening', 'period', 'ending'],
  8: ['opening', 'prior', 'period', 'ending'],
  10: ['opening', 'prior', 'period', 'turnover', 'ending'],
};

export const TRIAL_BALANCE_GROUP_TITLES: Readonly<Record<TrialBalanceGroup, string>> = {
  opening: 'افتتاحیه',
  prior: 'گردش قبل',
  period: 'گردش دوره',
  turnover: 'جمع گردش',
  ending: 'مانده',
};

/** The ancestor at `level`, or the account itself when the chart has no such ancestor. */
export function rollUp(
  account: ReportAccount,
  level: AccountLevel | undefined,
  byCode: ReadonlyMap<string, ReportAccount>,
): ReportAccount {
  if (!level) {
    return account;
  }
  const seen = new Set<string>();
  let current: ReportAccount | undefined = account;
  while (current && !seen.has(current.code)) {
    if (current.level === level) {
      return current;
    }
    seen.add(current.code);
    current = current.parentCode ? byCode.get(current.parentCode) : undefined;
  }
  return account;
}

const debitSide = (value: bigint): bigint => (value > 0n ? value : 0n);
const creditSide = (value: bigint): bigint => (value < 0n ? -value : 0n);

/**
 * `includeClosing` shows balances after income summary and retained earnings transfers; the default
 * shows a closed year's temporary accounts as they stood before the close.
 */
export function trialBalanceRows(
  balances: AccountBalance[],
  accounts: readonly ReportAccount[],
  options: { level?: AccountLevel; includeClosing?: boolean } = {},
): TrialBalanceRow[] {
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const groups = new Map<string, { account: ReportAccount; members: AccountBalance[] }>();
  for (const balance of balances) {
    const target = rollUp(balance.account, options.level, byCode);
    const group = groups.get(target.code) ?? { account: target, members: [] };
    group.members.push(balance);
    groups.set(target.code, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.account.code.localeCompare(b.account.code))
    .map(({ account, members }) => {
      const opening = sum(members, (b) => b.opening);
      const priorDebit = sum(members, (b) => b.priorDebit);
      const priorCredit = sum(members, (b) => b.priorCredit);
      const periodDebit =
        sum(members, (b) => b.periodDebit) + (options.includeClosing ? sum(members, (b) => b.closeDebit) : 0n);
      const periodCredit =
        sum(members, (b) => b.periodCredit) + (options.includeClosing ? sum(members, (b) => b.closeCredit) : 0n);
      const openingDebit = debitSide(opening);
      const openingCredit = creditSide(opening);
      const turnoverDebit = openingDebit + priorDebit + periodDebit;
      const turnoverCredit = openingCredit + priorCredit + periodCredit;
      const closing = turnoverDebit - turnoverCredit;
      return {
        code: account.code,
        name: account.name,
        level: account.level,
        openingDebit,
        openingCredit,
        priorDebit,
        priorCredit,
        periodDebit,
        periodCredit,
        turnoverDebit,
        turnoverCredit,
        endingDebit: debitSide(closing),
        endingCredit: creditSide(closing),
      };
    })
    .filter((row) =>
      row.openingDebit + row.openingCredit + row.priorDebit + row.priorCredit + row.periodDebit + row.periodCredit !== 0n,
    );
}

export interface Dashboard {
  cash: bigint;
  bank: bigint;
  receivables: bigint;
  payables: bigint;
  sales: bigint;
  taxDue: bigint;
  inventory: bigint;
  netProfit: bigint;
}

/** Headline balances at the end of the period, read from the ledger. */
export function dashboard(balances: AccountBalance[]): Dashboard {
  const debit = (lines: readonly ReportLine[]): bigint =>
    sum(balances.filter((b) => lines.includes(b.line)), ending);
  const statement = incomeStatement(balances);
  return {
    cash: debit([L.CASH, L.PETTY_CASH]),
    bank: debit([L.BANK]),
    receivables: debit([L.RECEIVABLE]),
    payables: -debit([L.PAYABLE]),
    sales: statement.revenue.total,
    taxDue: -debit([L.TAX_PAYABLE]),
    inventory: debit([L.INVENTORY]),
    netProfit: statement.netProfit,
  };
}
