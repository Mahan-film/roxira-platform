import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, BANKING_RESOURCE_PATH } from "@/lib/api/config";
import type {
  AutoMatchResult,
  BankAccount,
  BookLine,
  CreateBankAccountDto,
  CashBox,
  ReconciliationSummary,
  StatementLine,
} from "@/types/banking";

// Same-origin proxy (next.config.ts rewrites); the NestJS origin never reaches the browser.
const BANKING_ENDPOINT = `${API_PROXY_BASE_PATH}/${BANKING_RESOURCE_PATH}`;

/** GET /enterprise-hub/banking/accounts */
export function listBankAccounts(signal?: AbortSignal): Promise<BankAccount[]> {
  return apiRequest<BankAccount[]>(`${BANKING_ENDPOINT}/accounts`, { method: "GET", signal });
}

/** POST /enterprise-hub/banking/accounts */
export function createBankAccount(
  payload: CreateBankAccountDto,
  signal?: AbortSignal,
): Promise<BankAccount> {
  return apiRequest<BankAccount>(`${BANKING_ENDPOINT}/accounts`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** GET /enterprise-hub/banking/accounts/:id/statement-lines */
export function listStatementLines(
  accountId: number,
  params: { status?: "matched" | "unmatched"; fromDate?: string; toDate?: string } = {},
  signal?: AbortSignal,
): Promise<StatementLine[]> {
  return apiRequest<StatementLine[]>(`${BANKING_ENDPOINT}/accounts/${accountId}/statement-lines`, {
    method: "GET",
    searchParams: params,
    signal,
  });
}

/** GET /enterprise-hub/banking/accounts/:id/book-lines */
export function listBookLines(
  accountId: number,
  params: { unmatchedOnly?: boolean; fromDate?: string; toDate?: string } = {},
  signal?: AbortSignal,
): Promise<BookLine[]> {
  return apiRequest<BookLine[]>(`${BANKING_ENDPOINT}/accounts/${accountId}/book-lines`, {
    method: "GET",
    searchParams: {
      unmatchedOnly: params.unmatchedOnly ? "true" : undefined,
      fromDate: params.fromDate,
      toDate: params.toDate,
    },
    signal,
  });
}

/** POST /enterprise-hub/banking/accounts/:id/auto-match */
export function autoMatch(
  accountId: number,
  payload: { windowDays?: number } = {},
): Promise<AutoMatchResult> {
  return apiRequest<AutoMatchResult>(`${BANKING_ENDPOINT}/accounts/${accountId}/auto-match`, {
    method: "POST",
    body: payload,
  });
}

/** GET /enterprise-hub/banking/accounts/:id/summary */
export function getReconciliationSummary(
  accountId: number,
  asOf?: string,
  signal?: AbortSignal,
): Promise<ReconciliationSummary> {
  return apiRequest<ReconciliationSummary>(`${BANKING_ENDPOINT}/accounts/${accountId}/summary`, {
    method: "GET",
    searchParams: { asOf },
    signal,
  });
}

/** POST /enterprise-hub/banking/statement-lines/:id/match */
export function matchStatementLine(lineId: number, journalLineId: number): Promise<StatementLine> {
  return apiRequest<StatementLine>(`${BANKING_ENDPOINT}/statement-lines/${lineId}/match`, {
    method: "POST",
    body: { journalLineId },
  });
}

/** DELETE /enterprise-hub/banking/statement-lines/:id/match */
export function unmatchStatementLine(lineId: number): Promise<StatementLine> {
  return apiRequest<StatementLine>(`${BANKING_ENDPOINT}/statement-lines/${lineId}/match`, {
    method: "DELETE",
  });
}

/** POST /enterprise-hub/banking/statement-lines/:id/journal-entry */
export function createEntryFromStatementLine(
  lineId: number,
  payload: { counterAccountCode: string; description?: string },
): Promise<StatementLine> {
  return apiRequest<StatementLine>(`${BANKING_ENDPOINT}/statement-lines/${lineId}/journal-entry`, {
    method: "POST",
    body: payload,
  });
}

/** GET /enterprise-hub/banking/cash-boxes */
export function listCashBoxes(signal?: AbortSignal): Promise<CashBox[]> {
  return apiRequest<CashBox[]>(`${BANKING_ENDPOINT}/cash-boxes`, { method: "GET", signal });
}
