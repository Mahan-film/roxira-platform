import { apiRequest } from "@/lib/api/http-client";
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

export const listFixedAssets = (signal?: AbortSignal) => apiRequest<FixedAsset[]>(BASE, { signal });

export const createFixedAsset = (body: CreateFixedAssetBody) =>
  apiRequest<FixedAsset>(BASE, { method: "POST", body });

export const disposeFixedAsset = (id: number, body: DisposeFixedAssetBody) =>
  apiRequest<FixedAssetDisposalResult>(`${BASE}/${id}/dispose`, { method: "POST", body });
