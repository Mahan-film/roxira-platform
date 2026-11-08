import { API_PROXY_BASE_PATH } from "@/lib/api/config";
import { apiDownloadPost, apiRequest } from "@/lib/api/http-client";

/** Controller `report-builder` (modules/report_builder), reached through the same-origin proxy. */
const REPORT_BUILDER = `${API_PROXY_BASE_PATH}/report-builder`;

export interface ReportDatasetColumn {
  id: string;
  labelFa: string;
  type: string;
  aggregatable: string[];
}

export interface ReportDataset {
  id: string;
  labelFa: string;
  descriptionFa: string;
  columns: ReportDatasetColumn[];
}

export interface ReportFilter {
  column: string;
  op: string;
  value: string;
}

export interface ReportQueryPayload {
  dataset: string;
  columns: string[];
  filters: ReportFilter[];
  limit?: number;
}

export interface ReportQueryResult {
  dataset: string;
  columns: Array<{ id: string; labelFa: string; type: string }>;
  /** Money cells are exact decimal strings (rials); format them with `formatMoneyRial`. */
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  durationMs: number;
}

/** GET /report-builder/datasets */
export function getReportDatasets(signal?: AbortSignal): Promise<ReportDataset[]> {
  return apiRequest<ReportDataset[]>(`${REPORT_BUILDER}/datasets`, { signal });
}

/** POST /report-builder/query */
export function runReportQuery(payload: ReportQueryPayload, signal?: AbortSignal): Promise<ReportQueryResult> {
  return apiRequest<ReportQueryResult>(`${REPORT_BUILDER}/query`, { method: "POST", body: payload, signal });
}

/** POST /report-builder/export (xlsx or pdf) */
export function exportReport(
  payload: ReportQueryPayload & { format: "xlsx" | "pdf"; title?: string },
): Promise<Blob> {
  return apiDownloadPost(`${REPORT_BUILDER}/export`, payload);
}
