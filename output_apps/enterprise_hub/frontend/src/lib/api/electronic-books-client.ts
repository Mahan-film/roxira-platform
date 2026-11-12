import {
  API_PROXY_BASE_PATH,
  TAX_COMPLIANCE_RESOURCE_PATH,
} from "@/lib/api/config";
import { apiDownloadWithParams, apiRequest } from "@/lib/api/http-client";

const BASE = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}/reports`;

export type ElectronicBooksUnit = "million_rial" | "rial";
export type ElectronicBooksVoucherScope =
  | "operational"
  | "opening"
  | "closing_temp"
  | "closing_perm";
export type ElectronicBooksFormat = "auto" | "xlsx" | "csv";

export interface ElectronicBooksPresetItem {
  key: string;
  label: string;
  year: number;
  quarter?: number;
  month?: number;
  half?: number;
  fromDay: string;
  toDay: string;
  endDateJalali: string;
  alreadyExported: boolean;
  lastExportedAt?: string;
}

export interface ElectronicBooksPresetsResponse {
  year: number;
  periodicityMonths: number;
  lastExportedEndDate: string | null;
  presets: ElectronicBooksPresetItem[];
}

export interface ElectronicBooksPreviewResponse {
  headers: string[];
  rowCount: number;
  recommendedFormat: "xlsx" | "csv";
  unit: ElectronicBooksUnit;
  voucherScope: ElectronicBooksVoucherScope;
  monthlyAggregate: boolean;
  roundingDifference: string;
  alreadyExported: boolean;
  lastExportedEndDate: string | null;
  warnings: string[];
  bounds: {
    fromDay: string;
    toDay: string;
    label: string;
    endDateJalali: string;
    periodicityMonths: number;
  };
  sampleRows: Array<Array<string | number>>;
}

export interface ElectronicBooksExportParams {
  year: number;
  quarter?: number;
  month?: number;
  half?: number;
  format?: ElectronicBooksFormat;
  unit?: ElectronicBooksUnit;
  voucherScope?: ElectronicBooksVoucherScope;
  monthlyAggregate?: boolean;
  roundingAccountCode?: string;
  roundingAccountName?: string;
}

export function getElectronicBooksPresets(
  year: number,
  signal?: AbortSignal,
): Promise<ElectronicBooksPresetsResponse> {
  return apiRequest<ElectronicBooksPresetsResponse>(`${BASE}/electronic-books/presets`, {
    searchParams: { year },
    signal,
  });
}

export function getElectronicBooksPreview(
  params: ElectronicBooksExportParams,
  signal?: AbortSignal,
): Promise<ElectronicBooksPreviewResponse> {
  return apiRequest<ElectronicBooksPreviewResponse>(`${BASE}/electronic-books/preview`, {
    searchParams: {
      year: params.year,
      quarter: params.quarter,
      month: params.month,
      half: params.half,
      unit: params.unit,
      voucherScope: params.voucherScope,
      monthlyAggregate: params.monthlyAggregate ? "true" : undefined,
      roundingAccountCode: params.roundingAccountCode,
      roundingAccountName: params.roundingAccountName,
    },
    signal,
  });
}

export async function downloadElectronicBooks(
  params: ElectronicBooksExportParams,
  explicitExt?: "xlsx" | "csv",
): Promise<void> {
  const endpoint =
    explicitExt === "xlsx"
      ? `${BASE}/electronic-books.xlsx`
      : explicitExt === "csv"
        ? `${BASE}/electronic-books.csv`
        : `${BASE}/electronic-books`;

  const blob = await apiDownloadWithParams(endpoint, {
    year: params.year,
    quarter: params.quarter,
    month: params.month,
    half: params.half,
    format: params.format,
    unit: params.unit,
    voucherScope: params.voucherScope,
    monthlyAggregate: params.monthlyAggregate ? "true" : undefined,
    roundingAccountCode: params.roundingAccountCode,
    roundingAccountName: params.roundingAccountName,
  });

  const resolvedExt =
    explicitExt ?? (params.format === "csv" ? "csv" : params.format === "xlsx" ? "xlsx" : "xlsx");
  const suffix = params.month
    ? `${params.year}-m${params.month}`
    : params.half
      ? `${params.year}-h${params.half}`
      : params.quarter
        ? `${params.year}-q${params.quarter}`
        : `${params.year}`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `electronic-books-${suffix}-${params.voucherScope ?? "operational"}.${resolvedExt}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
