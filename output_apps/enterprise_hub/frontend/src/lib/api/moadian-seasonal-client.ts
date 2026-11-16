import { apiDownloadWithParams, apiRequest, apiRequestText } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  TAX_COMPLIANCE_RESOURCE_PATH,
} from "@/lib/api/config";
import type {
  MoadianCredentialResponseDto,
  MoadianStatusResponse,
  MoadianSubmissionResponse,
  PutMoadianCredentialDto,
  SeasonalTransactionsResponse,
  SeasonalVatReport,
  VatReturnDraft,
} from "@/types/moadian-seasonal";

const BASE = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}`;

/** GET moadian/status — answers even when MOADIAN_ENABLED is off. */
export function getMoadianStatus(signal?: AbortSignal) {
  return apiRequest<MoadianStatusResponse>(`${BASE}/moadian/status`, { signal });
}

/** GET moadian/credentials — public credential info. */
export function getMoadianCredential(signal?: AbortSignal) {
  return apiRequest<MoadianCredentialResponseDto>(`${BASE}/moadian/credentials`, { signal });
}

/** PUT moadian/credentials — update or register taxpayer credentials. */
export function putMoadianCredential(payload: PutMoadianCredentialDto, signal?: AbortSignal) {
  return apiRequest<MoadianCredentialResponseDto>(`${BASE}/moadian/credentials`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

/** POST moadian/invoices/:id/submit (queued; 503 when the flag is off). */
export function submitToMoadian(invoiceId: string, signal?: AbortSignal) {
  return apiRequest<MoadianSubmissionResponse>(
    `${BASE}/moadian/invoices/${encodeURIComponent(invoiceId)}/submit`,
    { method: "POST", signal },
  );
}

/** GET moadian/submissions — list submission statuses for current tenant. */
export function listMoadianSubmissions(signal?: AbortSignal) {
  return apiRequest<MoadianSubmissionResponse[]>(`${BASE}/moadian/submissions`, { signal });
}

/** GET moadian/invoices/:id/status — 404 means never submitted. */
export function getMoadianSubmission(invoiceId: string, signal?: AbortSignal) {
  return apiRequest<MoadianSubmissionResponse>(
    `${BASE}/moadian/invoices/${encodeURIComponent(invoiceId)}/status`,
    { signal },
  );
}

export function getSeasonalVat(year: number, quarter: number, signal?: AbortSignal) {
  return apiRequest<SeasonalVatReport>(`${BASE}/reports/vat-seasonal`, {
    searchParams: { year, quarter },
    signal,
  });
}

export function getSeasonalTransactions(
  year: number,
  quarter: number,
  signal?: AbortSignal,
) {
  return apiRequest<SeasonalTransactionsResponse>(
    `${BASE}/reports/seasonal-transactions`,
    { searchParams: { year, quarter }, signal },
  );
}

export type SeasonalCsvKind =
  | "vat-seasonal"
  | "seasonal-transactions"
  | "seasonal-purchases"
  | "journal"
  | "ledger";

/** Download a seasonal CSV through the authenticated proxy and save it. */
export async function downloadSeasonalCsv(
  kind: SeasonalCsvKind,
  year: number,
  quarter: number,
): Promise<void> {
  const text = await apiRequestText(`${BASE}/reports/${kind}.csv`, {
    searchParams: { year, quarter },
  });
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${kind}-${year}-q${quarter}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function getVatReturn(year: number, quarter: number, signal?: AbortSignal) {
  return apiRequest<VatReturnDraft>(`${BASE}/reports/vat-return`, {
    searchParams: { year, quarter },
    signal,
  });
}

/** Save the VAT return draft as XLSX or PDF. */
export async function downloadVatReturn(
  format: "xlsx" | "pdf",
  year: number,
  quarter: number,
): Promise<void> {
  const blob = await apiDownloadWithParams(`${BASE}/reports/vat-return/export`, {
    year,
    quarter,
    format,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vat-return-${year}-q${quarter}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
