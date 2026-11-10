import {
  AccountLedgerResponse,
  ChartOfAccount,
  CopyJournalEntryDto,
  CreateAccountDto,
  CreateJournalEntryDto,
  JournalEntryResponse,
  JournalEntryStatus,
  PaginatedJournalEntryResponse,
  QueryAccountLedgerDto,
  QueryJournalEntryDto,
  TrialBalanceResponse,
  UpdateJournalEntryDto,
  VoucherAttachment,
} from "@/types/accounting";
import { apiDownload, apiRequest, apiUpload } from "@/lib/api/http-client";
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

/** ویرایش سند پیش‌نویس یا موقت — PUT /enterprise-hub/accounting/journal-entries/:id */
export async function updateJournalEntry(
  id: number,
  payload: UpdateJournalEntryDto,
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${id}`,
    {
      method: "PUT",
      body: payload,
      signal,
    },
  );
}

/** کپی سند به‌صورت پیش‌نویس — POST /enterprise-hub/accounting/journal-entries/:id/copy */
export async function copyJournalEntry(
  id: number,
  payload: CopyJournalEntryDto = {},
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${id}/copy`,
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
        fromDate: params.fromDate,
        toDate: params.toDate,
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

/** تغییر وضعیت سند (پیش‌نویس، موقت، قطعی) — POST /enterprise-hub/accounting/journal-entries/:id/status */
export async function changeJournalEntryStatus(
  id: number,
  status: JournalEntryStatus,
  expectedVersion?: number,
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${id}/status`,
    {
      method: "POST",
      body: { status, expectedVersion },
      signal,
    },
  );
}

/** برگشت سند قطعی‌شده با ایجاد سند معکوس — POST /enterprise-hub/accounting/journal-entries/:id/reverse */
export async function reverseJournalEntry(
  id: number,
  payload?: { date?: string; reason?: string },
  signal?: AbortSignal,
): Promise<JournalEntryResponse> {
  return apiRequest<JournalEntryResponse>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${id}/reverse`,
    {
      method: "POST",
      body: payload ?? {},
      signal,
    },
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

/** فهرست پیوست‌های سند — GET /enterprise-hub/accounting/journal-entries/:id/attachments */
export async function listVoucherAttachments(
  journalEntryId: number,
  signal?: AbortSignal,
): Promise<VoucherAttachment[]> {
  return apiRequest<VoucherAttachment[]>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${journalEntryId}/attachments`,
    { method: "GET", signal },
  );
}

/** بارگذاری پیوست سند — POST /enterprise-hub/accounting/journal-entries/:id/attachments */
export async function uploadVoucherAttachment(
  journalEntryId: number,
  file: File,
  signal?: AbortSignal,
): Promise<VoucherAttachment> {
  const form = new FormData();
  form.append("file", file);
  return apiUpload<VoucherAttachment>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${journalEntryId}/attachments`,
    form,
    signal,
  );
}

/** دانلود پیوست سند — GET .../journal-entries/:id/attachments/:attachmentId/download */
export async function downloadVoucherAttachment(
  journalEntryId: number,
  attachmentId: number,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiDownload(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${journalEntryId}/attachments/${attachmentId}/download`,
    signal,
  );
}

/** حذف نرم پیوست سند — DELETE /enterprise-hub/accounting/journal-entries/:id/attachments/:attachmentId */
export async function deleteVoucherAttachment(
  journalEntryId: number,
  attachmentId: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(
    `${ACCOUNTING_ENDPOINT}/journal-entries/${journalEntryId}/attachments/${attachmentId}`,
    { method: "DELETE", signal },
  );
}