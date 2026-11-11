import { apiDownloadWithParams, apiRequest } from "@/lib/api/http-client";
import { ACCOUNTING_RESOURCE_PATH, API_PROXY_BASE_PATH } from "@/lib/api/config";
import type {
  BalanceSheetReport,
  CashFlowReport,
  ChartTemplate,
  CostCentreTrialBalanceQuery,
  CostCentreTrialBalanceReport,
  DashboardReport,
  EquityChangesReport,
  FiscalYear,
  IncomeStatementReport,
  LedgerReport,
  Money,
  PettyCashFund,
  PettyCashStatement,
  ReportQuery,
  TrialBalanceColumns,
  TrialBalanceReport,
  ConsolidatedReportResponse,
} from "@/types/accounting-reports";

const BASE = `${API_PROXY_BASE_PATH}/${ACCOUNTING_RESOURCE_PATH}`;
const REPORTS = `${BASE}/reports`;
const PETTY_CASH = `${BASE}/petty-cash/funds`;

type Params = Record<string, string | number | undefined>;

const report = <T>(name: string, searchParams: Params, signal?: AbortSignal) =>
  apiRequest<T>(`${REPORTS}/${name}`, { searchParams, signal });

const params = (query: ReportQuery): Params => ({ ...query });

export const getDashboard = (query: ReportQuery, signal?: AbortSignal) =>
  report<DashboardReport>("dashboard", params(query), signal);
export const getTrialBalanceReport = (
  query: ReportQuery & { columns: TrialBalanceColumns; level?: string; accountCode?: string },
  signal?: AbortSignal,
) => report<TrialBalanceReport>("trial-balance", { ...query }, signal);
export const getSubsidiaryReport = (
  query: ReportQuery & { columns: TrialBalanceColumns; accountCode?: string },
  signal?: AbortSignal,
) => report<TrialBalanceReport>("subsidiary", { ...query }, signal);
export const getTrialBalanceByCostCentre = (
  query: CostCentreTrialBalanceQuery,
  signal?: AbortSignal,
) =>
  report<CostCentreTrialBalanceReport>(
    "trial-balance-by-cost-centre",
    {
      ...query,
      includeClosing: query.includeClosing ? "true" : undefined,
    },
    signal,
  );
export const getLedgerReport = (
  query: ReportQuery & { accountCode: string; partyCode?: string },
  signal?: AbortSignal,
) => report<LedgerReport>("ledger", { ...query }, signal);
export const getBalanceSheet = (query: ReportQuery, signal?: AbortSignal) =>
  report<BalanceSheetReport>("balance-sheet", params(query), signal);
export const getIncomeStatement = (query: ReportQuery, signal?: AbortSignal) =>
  report<IncomeStatementReport>("income-statement", params(query), signal);
export const getCashFlow = (query: ReportQuery, signal?: AbortSignal) =>
  report<CashFlowReport>("cash-flow", params(query), signal);
export const getEquityChanges = (query: ReportQuery, signal?: AbortSignal) =>
  report<EquityChangesReport>("equity-changes", params(query), signal);

/** Downloads a report as a file through the browser. */
export async function downloadReport(name: string, format: "xlsx" | "pdf", query: Params): Promise<void> {
  const blob = await apiDownloadWithParams(`${REPORTS}/export/${name}`, { ...query, format });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export const listFiscalYears = (signal?: AbortSignal) =>
  apiRequest<FiscalYear[]>(`${BASE}/fiscal-years`, { signal });
export const createFiscalYear = (body: { name: string; startDate: string; endDate: string }) =>
  apiRequest<FiscalYear>(`${BASE}/fiscal-years`, { method: "POST", body });
export const closeFiscalYear = (
  id: number,
  nextYear?: { name: string; startDate: string; endDate: string },
) =>
  apiRequest<{ entryNumbers: string[] }>(`${BASE}/fiscal-years/${id}/close`, {
    method: "POST",
    body: nextYear ? { nextYear } : {},
  });
export const reopenFiscalYear = (id: number, reason: string) =>
  apiRequest<FiscalYear>(`${BASE}/fiscal-years/${id}/reopen`, { method: "POST", body: { reason } });

export interface PeriodLock {
  id: number;
  periodStart: string;
  periodEnd: string;
  reason: string | null;
  lockedBy: string;
  lockedAt: string;
  active: boolean;
  unlockedAt: string | null;
}

export const listPeriodLocks = (signal?: AbortSignal) =>
  apiRequest<PeriodLock[]>(`${BASE}/period-locks`, { signal });
export const listChartTemplates = (signal?: AbortSignal) =>
  apiRequest<ChartTemplate[]>(`${BASE}/chart-templates`, { signal });
export const applyChartTemplate = (key: string) =>
  apiRequest<{ added: number; classified: number }>(`${BASE}/chart-templates/${key}/apply`, {
    method: "POST",
  });

export const listPettyCashFunds = (signal?: AbortSignal) =>
  apiRequest<PettyCashFund[]>(PETTY_CASH, { signal });
export const createPettyCashFund = (body: { name: string; custodianName: string; imprestAmount: Money }) =>
  apiRequest<PettyCashFund>(PETTY_CASH, { method: "POST", body });
export const getPettyCashStatement = (id: number, signal?: AbortSignal) =>
  apiRequest<PettyCashStatement>(`${PETTY_CASH}/${id}`, { signal });
export const chargePettyCash = (id: number, body: { amount: Money; date: string; accountCode: string }) =>
  apiRequest(`${PETTY_CASH}/${id}/charge`, { method: "POST", body });
export const returnPettyCash = (id: number, body: { amount: Money; date: string; accountCode: string }) =>
  apiRequest(`${PETTY_CASH}/${id}/return`, { method: "POST", body });
export const addPettyCashExpense = (
  id: number,
  body: { amount: Money; date: string; accountCode: string; description: string; receiptNumber?: string },
) => apiRequest(`${PETTY_CASH}/${id}/expenses`, { method: "POST", body });
export const voidPettyCashExpense = (id: number, expenseId: number) =>
  apiRequest(`${PETTY_CASH}/${id}/expenses/${expenseId}/void`, { method: "POST" });
export const settlePettyCash = (
  id: number,
  body: { expenseIds: number[]; date: string; replenishFromAccountCode?: string },
) => apiRequest<PettyCashStatement>(`${PETTY_CASH}/${id}/settle`, { method: "POST", body });
export const closePettyCashFund = (id: number) =>
  apiRequest<PettyCashFund>(`${PETTY_CASH}/${id}/close`, { method: "POST" });

export interface BudgetVsActualRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  costCenterId: number | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  budgetAmount: Money;
  actualAmount: Money;
  varianceAmount: Money;
  variancePercent: number | null;
  utilizationPercent: number | null;
}

export interface BudgetVsActualReport {
  fiscalYearId: number;
  fiscalYearName: string;
  startDate: string;
  endDate: string;
  totalBudget: Money;
  totalActual: Money;
  totalVariance: Money;
  overallUtilizationPercent: number | null;
  rows: BudgetVsActualRow[];
}

export const getBudgetVsActual = (
  query: { fiscalYearId: number; costCenterId?: number; costCenterCode?: string },
  signal?: AbortSignal,
) => report<BudgetVsActualReport>("budget-vs-actual", { ...query }, signal);

export const setAccountBudget = (body: {
  fiscalYearId: number;
  accountCode: string;
  budgetAmount: Money;
  costCenterId?: number;
}) => apiRequest(`${REPORTS}/budgets`, { method: "PUT", body });

export const getConsolidatedReport = (
  query?: { asOfDate?: string; tenantIds?: string[] },
  signal?: AbortSignal,
) => {
  const searchParams: Record<string, string | undefined> = {};
  if (query?.asOfDate) searchParams.asOfDate = query.asOfDate;
  if (query?.tenantIds && query.tenantIds.length > 0) {
    searchParams.tenantIds = query.tenantIds.join(",");
  }
  return report<ConsolidatedReportResponse>("consolidated", searchParams, signal);
};
