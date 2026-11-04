import { apiRequest, apiRequestText } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  TAX_COMPLIANCE_RESOURCE_PATH,
} from "@/lib/api/config";
import type {
  MoadianStatusResponse,
  MoadianSubmissionResponse,
  SeasonalTransactionsResponse,
  SeasonalVatReport,
} from "@/types/moadian-seasonal";

const BASE = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}`;

/** GET moadian/status — answers even when MOADIAN_ENABLED is off. */
export function getMoadianStatus(signal?: AbortSignal) {
  return apiRequest<MoadianStatusResponse>(`${BASE}/moadian/status`, { signal });
}

/** POST moadian/invoices/:id/submit (queued; 503 when the flag is off). */
export function submitToMoadian(invoiceId: string, signal?: AbortSignal) {
  return apiRequest<MoadianSubmissionResponse>(
    `${BASE}/moadian/invoices/${encodeURIComponent(invoiceId)}/submit`,
    { method: "POST", signal },
  );
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
  | "seasonal-purchases";

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
