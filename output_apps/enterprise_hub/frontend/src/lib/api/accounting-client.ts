import {
  AccountLedgerResponse,
  ChartOfAccount,
  CreateAccountDto,
  CreateJournalEntryDto,
  JournalEntryResponse,
  PaginatedJournalEntryResponse,
  QueryAccountLedgerDto,
  QueryJournalEntryDto,
  TrialBalanceResponse,
} from "@/types/accounting";
import { apiRequest } from "@/lib/api/http-client";
import {
  ACCOUNTING_RESOURCE_PATH,
  API_PROXY_BASE_PATH,
} from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const ACCOUNTING_ENDPOINT = `${API_PROXY_BASE_PATH}/${ACCOUNTING_RESOURCE_PATH}`;

/** فهرست حساب‌های دفتر کل — GET /enterprise-hub/accounting/accounts */
export async function listAccounts(
  signal?: AbortSignal,
): Promise<ChartOfAccount[]> {
  return apiRequest<ChartOfAccount[]>(`${ACCOUNTING_ENDPOINT}/accounts`, {
    method: "GET",
    signal,
  });
}

/** ایجاد حساب جدید — POST /enterprise-hub/accounting/accounts */
export async function createAccount(
  payload: CreateAccountDto,
  signal?: AbortSignal,
): Promise<ChartOfAccount> {
  return apiRequest<ChartOfAccount>(`${ACCOUNTING_ENDPOINT}/accounts`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** ثبت سند دوطرفه — POST /enterprise-hub/accounting/journal-entries */
export async function createJournalEntry(
  payload: CreateJournalEntryDto,
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries`,
    {
      method: "POST",
      body: payload,
      signal,
    },
  );
}

/** فهرست صفحه‌بندی‌شده اسناد — GET /enterprise-hub/accounting/journal-entries */
export async function listJournalEntries(
  params: QueryJournalEntryDto = {},
  signal?: AbortSignal,
): Promise<PaginatedJournalEntryResponse> {
  return apiRequest<PaginatedJournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries`,
    {
      method: "GET",
      searchParams: {
        page: params.page,
        limit: params.limit,
        status: params.status,
        entryNumber: params.entryNumber,
      },
      signal,
    },
  );
}

/** یک سند بر اساس شناسه — GET /enterprise-hub/accounting/journal-entries/:id */
export async function getJournalEntry(
  id: number,
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${id}`,
    { method: "GET", signal },
  );
}

/** تراز آزمایشی دفتر کل — GET /enterprise-hub/accounting/trial-balance */
export async function getTrialBalance(
  signal?: AbortSignal,
): Promise<TrialBalanceResponse> {
  return apiRequest<TrialBalanceResponse>(
    `${ACCOUNTING_ENDPOINT}/trial-balance`,
    { method: "GET", signal },
  );
}

/** گردش حساب — GET /enterprise-hub/accounting/accounts/:code/ledger */
export async function getAccountLedger(
  code: string,
  params: QueryAccountLedgerDto = {},
  signal?: AbortSignal,
): Promise<AccountLedgerResponse> {
  return apiRequest<AccountLedgerResponse>(
    `${ACCOUNTING_ENDPOINT}/accounts/${encodeURIComponent(code)}/ledger`,
    {
      method: "GET",
      searchParams: {
        fromDate: params.fromDate,
        toDate: params.toDate,
        limit: params.limit,
      },
      signal,
    },
  );
}