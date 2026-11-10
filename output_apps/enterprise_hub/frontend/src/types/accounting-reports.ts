/** Mirrors the accounting report, fiscal year and petty cash DTOs of the NestJS API. */

/** Exact JSON money: a number when exact, otherwise a decimal string. */
export type Money = number | string;

export interface ReportPeriod {
  yearStart: string;
  from: string;
  to: string;
}

export interface ReportQuery {
  fiscalYearId?: number;
  from?: string;
  to?: string;
}

export interface InferredAccount {
  code: string;
  name: string;
  line: string;
}

export type TrialBalanceColumns = 2 | 4 | 6 | 8 | 10;
export type TrialBalanceGroup = "opening" | "prior" | "period" | "turnover" | "ending";

export const TRIAL_BALANCE_GROUP_LABELS: Record<TrialBalanceGroup, string> = {
  opening: "افتتاحیه",
  prior: "گردش قبل",
  period: "گردش دوره",
  turnover: "جمع گردش",
  ending: "مانده",
};

export type TrialBalanceAmounts = Record<`${TrialBalanceGroup}${"Debit" | "Credit"}`, Money>;

export interface TrialBalanceRow extends TrialBalanceAmounts {
  code: string;
  name: string;
  level: string | null;
}

export interface TrialBalanceReport {
  period: ReportPeriod;
  columns: TrialBalanceColumns;
  groups: TrialBalanceGroup[];
  rows: TrialBalanceRow[];
  totals: TrialBalanceAmounts;
  /** Null on a subsidiary report: parties are only part of the ledger. */
  balanced: boolean | null;
}

export interface LedgerReport {
  period: ReportPeriod;
  accountCode: string;
  accountName: string;
  opening: Money;
  totalDebit: Money;
  totalCredit: Money;
  closing: Money;
  truncated: boolean;
  lines: Array<{
    journalEntryId: number;
    entryNumber: string;
    date: string;
    accountCode: string;
    accountName: string;
    partyCode: string | null;
    description: string;
    debit: Money;
    credit: Money;
    running: Money;
  }>;
}

export interface StatementLine {
  line: string;
  title: string;
  amount: Money;
}

export interface StatementSection {
  key: string;
  title: string;
  lines: StatementLine[];
  total: Money;
}

export interface ReconciliationCheck {
  key: string;
  title: string;
  ok: boolean;
}

interface StatementBase {
  period: ReportPeriod;
  inferredAccounts: InferredAccount[];
}

export interface BalanceSheetReport extends StatementBase {
  currentAssets: StatementSection;
  nonCurrentAssets: StatementSection;
  totalAssets: Money;
  currentLiabilities: StatementSection;
  nonCurrentLiabilities: StatementSection;
  totalLiabilities: Money;
  equity: StatementSection;
  totalEquity: Money;
  totalLiabilitiesAndEquity: Money;
  checks: ReconciliationCheck[];
}

export interface IncomeStatementReport extends StatementBase {
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: Money;
  operatingExpenses: StatementSection;
  otherOperatingIncome: StatementSection;
  operatingProfit: Money;
  financeCosts: StatementSection;
  nonOperating: StatementSection;
  profitBeforeTax: Money;
  incomeTax: StatementSection;
  netProfit: Money;
}

export interface CashFlowReport extends StatementBase {
  netProfit: Money;
  operating: StatementSection;
  operatingCash: Money;
  investing: StatementSection;
  financing: StatementSection;
  netChange: Money;
  openingCash: Money;
  closingCash: Money;
  checks: ReconciliationCheck[];
}

export interface EquityRow {
  key: string;
  title: string;
  capital: Money;
  legalReserve: Money;
  otherReserves: Money;
  retainedEarnings: Money;
  total: Money;
}

export interface EquityChangesReport extends StatementBase {
  rows: EquityRow[];
  checks: ReconciliationCheck[];
}

export interface DashboardReport extends StatementBase {
  cash: Money;
  bank: Money;
  receivables: Money;
  payables: Money;
  sales: Money;
  taxDue: Money;
  inventory: Money;
  netProfit: Money;
}

export interface FiscalYear {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
}

export interface ChartTemplate {
  key: string;
  name: string;
  description: string;
  accountCount: number;
}

export interface PettyCashFund {
  id: number;
  name: string;
  custodianName: string;
  ledgerAccountCode: string;
  imprestAmount: Money;
  status: "ACTIVE" | "CLOSED";
  balance: Money;
  pending: Money;
  available: Money;
}

export interface PettyCashTransaction {
  id: number;
  kind: "CHARGE" | "RETURN" | "EXPENSE";
  status: "PENDING" | "SETTLED" | "POSTED" | "VOID";
  date: string;
  amount: Money;
  accountCode: string;
  description: string;
  receiptNumber: string | null;
}

export interface PettyCashStatement {
  fund: PettyCashFund;
  transactions: PettyCashTransaction[];
}

export const UNASSIGNED_CENTRE_NAME = "بدون مرکز هزینه";

export interface CostCentreSection {
  /** Null for the lines that carry no cost centre. */
  code: string | null;
  name: string;
  parentCode: string | null;
  depth: number;
  /** Per account, over this centre and every centre under it. */
  rows: TrialBalanceRow[];
  totals: TrialBalanceAmounts;
}

export interface CostCentreTrialBalanceReport {
  period: ReportPeriod;
  columns: TrialBalanceColumns;
  groups: TrialBalanceGroup[];
  costCenterCode: string | null;
  centres: CostCentreSection[];
  /** Each line counted once. */
  totals: TrialBalanceAmounts;
  /** Whole-ledger check without a filter; null for one centre's subtree. */
  balanced: boolean | null;
}

export interface CostCentreTrialBalanceQuery extends ReportQuery {
  columns?: TrialBalanceColumns;
  level?: string;
  includeClosing?: boolean;
  costCenterCode?: string;
}

