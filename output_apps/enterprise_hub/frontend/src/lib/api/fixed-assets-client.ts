import { apiDownloadWithParams, apiRequest } from "@/lib/api/http-client";
import { ACCOUNTING_RESOURCE_PATH, API_PROXY_BASE_PATH } from "@/lib/api/config";
import type { Money } from "@/types/accounting-reports";

const BASE = `${API_PROXY_BASE_PATH}/${ACCOUNTING_RESOURCE_PATH}/fixed-assets`;

export type FixedAssetStatus = "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
export type FixedAssetMethod = "STRAIGHT_LINE" | "DECLINING_BALANCE";

/** نقش‌هایی که حساب آنها می‌تواند عواید فروش دارایی را بگیرد (دارایی‌ها). */
export const CASH_ACCOUNT_ROLES = [
  { role: "cash", label: "صندوق" },
  { role: "bank", label: "بانک" },
  { role: "pos_clearing", label: "تسویه کارت‌خوان" },
  { role: "petty_cash", label: "تنخواه" },
] as const;

export type CashAccountRole = (typeof CASH_ACCOUNT_ROLES)[number]["role"];

export interface FixedAsset {
  id: number;
  code: string;
  name: string;
  category: string;
  acquisitionDate: string;
  cost: Money;
  salvageValue: Money;
  method: FixedAssetMethod;
  assetAccountCode: string;
  accumulatedAccountCode: string;
  expenseAccountCode: string;
  accumulatedDepreciation: Money;
  status: FixedAssetStatus;
  disposalDate: string | null;
  disposalProceeds: Money | null;
  netBookValue: Money;
}

export interface CreateFixedAssetBody {
  code: string;
  name: string;
  category: string;
  acquisitionDate: string;
  cost: Money;
  salvageValue?: Money;
  method: FixedAssetMethod;
  lifeMonths?: number;
  annualRate?: string;
  rateSource?: string;
  assetAccountCode: string;
  accumulatedAccountCode: string;
  expenseAccountCode: string;
}

export interface DisposeFixedAssetBody {
  date: string;
  proceeds: Money;
  cashAccountRole?: CashAccountRole;
  settlementAccountCode?: string;
  note?: string;
}

export interface FixedAssetDisposalResult {
  id: number;
  code: string;
  name: string;
  status: "DISPOSED";
  date: string;
  cost: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  proceeds: string;
  gain: string;
  loss: string;
  journalEntryId: number;
  journalEntryNumber: string;
}

export interface FixedAssetRegisterRow {
  code: string;
  name: string;
  category: string;
  acquisitionDate: string;
  method: FixedAssetMethod;
  status: FixedAssetStatus;
  costMinor: Money;
  accumulatedMinor: Money;
  bookValueMinor: Money;
}

export interface FixedAssetRegisterTotals {
  costMinor: Money;
  accumulatedMinor: Money;
  bookValueMinor: Money;
}

export interface FixedAssetRegisterResult {
  rows: FixedAssetRegisterRow[];
  totals: FixedAssetRegisterTotals;
}

export interface DepreciationScheduleRow {
  period: number;
  day: string;
  chargeMinor: Money;
  accumulatedMinor: Money;
  bookValueMinor: Money;
}

export interface DepreciationScheduleResult {
  assetCode: string;
  assetName: string;
  method: FixedAssetMethod;
  openingAccumulatedMinor: Money;
  rows: DepreciationScheduleRow[];
  closingAccumulatedMinor: Money;
  closingBookValueMinor: Money;
}

export interface DepreciationRunBody {
  year: number;
  month: number;
}

export interface DepreciationRunResult {
  year: number;
  month: number;
  entryNumber: string | null;
  entryNumbers: string[];
  totalCharged: Money;
  charged: Array<{ code: string; amount: Money }>;
  zeroCharge: string[];
  skipped: Array<{ code: string; reason: "ALREADY_DONE" | "NOT_ACQUIRED_YET" | "PREVIOUS_MONTH_MISSING" }>;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const listFixedAssets = (signal?: AbortSignal) => apiRequest<FixedAsset[]>(BASE, { signal });

export const getFixedAssetRegister = (signal?: AbortSignal) =>
  apiRequest<FixedAssetRegisterResult>(`${BASE}/register`, { signal });

export async function downloadFixedAssetRegister(format: "xlsx" | "pdf"): Promise<void> {
  const blob = await apiDownloadWithParams(`${BASE}/register`, { format });
  triggerDownload(blob, `fixed-asset-register.${format}`);
}

export const getFixedAssetSchedule = (code: string, signal?: AbortSignal) =>
  apiRequest<DepreciationScheduleResult>(`${BASE}/${encodeURIComponent(code)}/schedule`, { signal });

export async function downloadFixedAssetSchedule(code: string, format: "xlsx" | "pdf"): Promise<void> {
  const blob = await apiDownloadWithParams(`${BASE}/${encodeURIComponent(code)}/schedule`, { format });
  triggerDownload(blob, `depreciation-schedule-${code}.${format}`);
}

export const runMonthlyDepreciation = (body: DepreciationRunBody) =>
  apiRequest<DepreciationRunResult>(`${BASE}/depreciation-runs`, { method: "POST", body });

export const createFixedAsset = (body: CreateFixedAssetBody) =>
  apiRequest<FixedAsset>(BASE, { method: "POST", body });

export const disposeFixedAsset = (id: number, body: DisposeFixedAssetBody) =>
  apiRequest<FixedAssetDisposalResult>(`${BASE}/${id}/dispose`, { method: "POST", body });
