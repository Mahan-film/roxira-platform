import { LedgerReport, ResolvedPeriod, TrialBalanceReport } from '../services/financial-reports.service';
import { ReportColumn, ReportRow, ReportTable } from './report-table';
import {
  BalanceSheet,
  CashFlowStatement,
  EquityChanges,
  IncomeStatement,
  StatementSection,
  TRIAL_BALANCE_GROUP_TITLES,
} from './statements';

const jalali = (day: string): string =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', dateStyle: 'short' }).format(
    new Date(`${day}T12:00:00.000Z`),
  );

const periodText = (period: ResolvedPeriod): string =>
  `از ${jalali(period.from)} تا ${jalali(period.to)} (مبالغ به ریال)`;

const dateText = (period: ResolvedPeriod): string => `در تاریخ ${jalali(period.to)} (مبالغ به ریال)`;

const STATEMENT_COLUMNS: ReportColumn[] = [
  { title: 'شرح', width: 3 },
  { title: 'مبلغ (ریال)', width: 1.4, money: true },
];

const sectionRows = (section: StatementSection, totalTitle?: string): ReportRow[] => [
  { cells: [section.title, null], bold: true },
  ...section.lines.map((line) => ({ cells: [line.title, line.amount] })),
  ...(totalTitle ? [{ cells: [totalTitle, section.total], bold: true }] : []),
];

export function trialBalanceTable(report: TrialBalanceReport, title: string): ReportTable {
  const columns: ReportColumn[] = [
    { title: 'کد', width: 0.7 },
    { title: 'نام حساب', width: 1.8 },
    ...report.groups.flatMap((group) => [
      { title: `${TRIAL_BALANCE_GROUP_TITLES[group]} بدهکار`, money: true },
      { title: `${TRIAL_BALANCE_GROUP_TITLES[group]} بستانکار`, money: true },
    ]),
  ];
  const amounts = (row: TrialBalanceReport['totals']) =>
    report.groups.flatMap((group) => [row[`${group}Debit`], row[`${group}Credit`]]);
  return {
    title,
    subtitle: periodText(report.period),
    columns,
    rows: [
      ...report.rows.map((row) => ({ cells: [row.code, row.name, ...amounts(row)] })),
      { cells: ['', 'جمع', ...amounts(report.totals)], bold: true },
    ],
  };
}

export function ledgerTable(report: LedgerReport): ReportTable {
  return {
    title: `دفتر حساب ${report.accountCode} ${report.accountName}`,
    subtitle:
      periodText(report.period) +
      (report.partyCode ? `، تفصیلی ${report.partyCode}` : '') +
      (report.truncated ? '، فهرست کوتاه شده؛ جمع‌ها کامل است' : ''),
    columns: [
      { title: 'تاریخ', width: 0.8 },
      { title: 'سند', width: 0.8 },
      { title: 'حساب', width: 0.7 },
      { title: 'شرح', width: 2.2 },
      { title: 'بدهکار', money: true },
      { title: 'بستانکار', money: true },
      { title: 'مانده', money: true },
    ],
    rows: [
      { cells: ['', '', '', 'مانده ابتدای دوره', null, null, report.opening], bold: true },
      ...report.lines.map((line) => ({
        cells: [jalali(line.date), line.entryNumber, line.accountCode, line.description, line.debit, line.credit, line.running],
      })),
      { cells: ['', '', '', 'جمع و مانده پایان دوره', report.totalDebit, report.totalCredit, report.closing], bold: true },
    ],
  };
}

export function balanceSheetTable(report: BalanceSheet & { period: ResolvedPeriod }): ReportTable {
  return {
    title: 'صورت وضعیت مالی (ترازنامه)',
    subtitle: dateText(report.period),
    columns: STATEMENT_COLUMNS,
    rows: [
      ...sectionRows(report.currentAssets, 'جمع دارایی‌های جاری'),
      ...sectionRows(report.nonCurrentAssets, 'جمع دارایی‌های غیرجاری'),
      { cells: ['جمع دارایی‌ها', report.totalAssets], bold: true },
      ...sectionRows(report.currentLiabilities, 'جمع بدهی‌های جاری'),
      ...sectionRows(report.nonCurrentLiabilities, 'جمع بدهی‌های غیرجاری'),
      { cells: ['جمع بدهی‌ها', report.totalLiabilities], bold: true },
      ...sectionRows(report.equity, 'جمع حقوق مالکانه'),
      { cells: ['جمع بدهی‌ها و حقوق مالکانه', report.totalLiabilitiesAndEquity], bold: true },
    ],
  };
}

export function incomeStatementTable(report: IncomeStatement & { period: ResolvedPeriod }): ReportTable {
  const lines = (section: StatementSection): ReportRow[] =>
    section.lines.map((line) => ({ cells: [line.title, line.amount] }));
  return {
    title: 'صورت سود و زیان',
    subtitle: periodText(report.period),
    columns: STATEMENT_COLUMNS,
    rows: [
      ...lines(report.revenue),
      ...lines(report.costOfSales),
      { cells: ['سود (زیان) ناخالص', report.grossProfit], bold: true },
      ...lines(report.operatingExpenses),
      ...lines(report.otherOperatingIncome),
      { cells: ['سود (زیان) عملیاتی', report.operatingProfit], bold: true },
      ...lines(report.financeCosts),
      ...lines(report.nonOperating),
      { cells: ['سود (زیان) قبل از مالیات', report.profitBeforeTax], bold: true },
      ...lines(report.incomeTax),
      { cells: ['سود (زیان) خالص', report.netProfit], bold: true },
    ],
  };
}

export function cashFlowTable(report: CashFlowStatement & { period: ResolvedPeriod }): ReportTable {
  return {
    title: 'صورت جریان‌های نقدی',
    subtitle: `${periodText(report.period)}، روش غیرمستقیم`,
    columns: STATEMENT_COLUMNS,
    rows: [
      { cells: ['سود (زیان) خالص', report.netProfit] },
      ...sectionRows(report.operating),
      { cells: ['جریان خالص نقد از فعالیت‌های عملیاتی', report.operatingCash], bold: true },
      ...sectionRows(report.investing, 'جریان خالص نقد از فعالیت‌های سرمایه‌گذاری'),
      ...sectionRows(report.financing, 'جریان خالص نقد از فعالیت‌های تأمین مالی'),
      { cells: ['خالص افزایش (کاهش) در موجودی نقد', report.netChange], bold: true },
      { cells: ['موجودی نقد ابتدای دوره', report.openingCash] },
      { cells: ['موجودی نقد پایان دوره', report.closingCash], bold: true },
    ],
  };
}

export function equityChangesTable(report: EquityChanges & { period: ResolvedPeriod }): ReportTable {
  return {
    title: 'صورت تغییرات در حقوق مالکانه',
    subtitle: periodText(report.period),
    columns: [
      { title: 'شرح', width: 2.4 },
      { title: 'سرمایه', money: true },
      { title: 'اندوخته قانونی', money: true },
      { title: 'سایر اندوخته‌ها', money: true },
      { title: 'سود انباشته', money: true },
      { title: 'جمع کل', money: true },
    ],
    rows: report.rows.map((row) => ({
      cells: [row.title, row.capital, row.legalReserve, row.otherReserves, row.retainedEarnings, row.total],
      bold: row.key === 'closing',
    })),
  };
}
