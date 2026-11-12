import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, CHEQUES_RESOURCE_PATH } from "@/lib/api/config";
import type {
  BouncedCheques,
  Cheque,
  ChequeDetail,
  ChequeRecon,
  ChequeDirection,
  ChequeStatus,
  CreateChequeDto,
  DueCheques,
  PartialPaymentDto,
  ReconApplyResult,
  ReconItem,
  TransitionChequeDto,
  VerifySayadDto,
} from "@/types/cheques";

// Same-origin proxy (next.config.ts rewrites); the NestJS origin never reaches the browser.
const CHEQUES_ENDPOINT = `${API_PROXY_BASE_PATH}/${CHEQUES_RESOURCE_PATH}`;

/** GET /enterprise-hub/cheques */
export function listCheques(
  params: { direction?: ChequeDirection; status?: ChequeStatus; dueFrom?: string; dueTo?: string } = {},
  signal?: AbortSignal,
): Promise<Cheque[]> {
  return apiRequest<Cheque[]>(CHEQUES_ENDPOINT, { method: "GET", searchParams: params, signal });
}

/** GET /enterprise-hub/cheques/due */
export function listDueCheques(days = 30, signal?: AbortSignal): Promise<DueCheques> {
  return apiRequest<DueCheques>(`${CHEQUES_ENDPOINT}/due`, {
    method: "GET",
    searchParams: { days: String(days) },
    signal,
  });
}

/** POST /enterprise-hub/cheques */
export function createCheque(payload: CreateChequeDto, signal?: AbortSignal): Promise<Cheque> {
  return apiRequest<Cheque>(CHEQUES_ENDPOINT, { method: "POST", body: payload, signal });
}

/** POST /enterprise-hub/cheques/:id/transition — returns the cheque plus its events (ChequeDetailResponseDto). */
export function transitionCheque(
  id: number,
  payload: TransitionChequeDto,
  signal?: AbortSignal,
): Promise<ChequeDetail> {
  return apiRequest<ChequeDetail>(`${CHEQUES_ENDPOINT}/${id}/transition`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** POST /enterprise-hub/cheques/:id/partial-payment */
export function partialPayment(id: number, payload: PartialPaymentDto, signal?: AbortSignal): Promise<Cheque> {
  return apiRequest<Cheque>(`${CHEQUES_ENDPOINT}/${id}/partial-payment`, { method: "POST", body: payload, signal });
}

/** POST /enterprise-hub/cheques/:id/sayad-verification (manual flag; no Sayad call) */
export function verifySayad(id: number, payload: VerifySayadDto, signal?: AbortSignal): Promise<Cheque> {
  return apiRequest<Cheque>(`${CHEQUES_ENDPOINT}/${id}/sayad-verification`, { method: "POST", body: payload, signal });
}

/** GET /enterprise-hub/cheques/bounced */
export function listBouncedCheques(
  params: { direction?: ChequeDirection; asOf?: string } = {},
  signal?: AbortSignal,
): Promise<BouncedCheques> {
  return apiRequest<BouncedCheques>(`${CHEQUES_ENDPOINT}/bounced`, { method: "GET", searchParams: params, signal });
}

/** GET /enterprise-hub/cheques/reconciliation */
export function getChequeRecon(
  params: { bankAccountId: number; fromDate?: string; toDate?: string; windowDays?: number },
  signal?: AbortSignal,
): Promise<ChequeRecon> {
  const searchParams: Record<string, string> = { bankAccountId: String(params.bankAccountId) };
  if (params.fromDate) searchParams.fromDate = params.fromDate;
  if (params.toDate) searchParams.toDate = params.toDate;
  if (params.windowDays !== undefined) searchParams.windowDays = String(params.windowDays);
  return apiRequest<ChequeRecon>(`${CHEQUES_ENDPOINT}/reconciliation`, { method: "GET", searchParams, signal });
}

/** POST /enterprise-hub/cheques/reconciliation/match */
export function matchChequeRecon(
  payload: { bankAccountId: number; eventId: number; statementLineId: number },
  signal?: AbortSignal,
): Promise<ReconItem> {
  return apiRequest<ReconItem>(`${CHEQUES_ENDPOINT}/reconciliation/match`, { method: "POST", body: payload, signal });
}

/** POST /enterprise-hub/cheques/reconciliation/apply */
export function applyChequeRecon(
  payload: { bankAccountId: number; fromDate?: string; toDate?: string; windowDays?: number },
  signal?: AbortSignal,
): Promise<ReconApplyResult> {
  return apiRequest<ReconApplyResult>(`${CHEQUES_ENDPOINT}/reconciliation/apply`, { method: "POST", body: payload, signal });
}

export interface ServerCalculatorItem {
  id?: string | number;
  amount: string;
  dueDate: string;
  sayadNumber?: string;
  description?: string;
}

export interface ServerDiscountResult {
  totalAmount: string;
  totalDiscountAmount: string;
  netPresentValue: string;
  annualRatePercent: number;
  baseDate: string;
  weightedAverageDays: number;
  items: Array<{
    id?: string | number;
    amount: string;
    dueDate: string;
    days: number;
    discountAmount: string;
    netPresentValue: string;
    effectivePeriodRatePercent: number;
  }>;
}

/** POST /enterprise-hub/cheques/calculator/discount */
export function calculateDiscountApi(
  payload: { items: ServerCalculatorItem[]; annualRatePercent: number; baseDate?: string },
  signal?: AbortSignal,
): Promise<ServerDiscountResult> {
  return apiRequest<ServerDiscountResult>(`${CHEQUES_ENDPOINT}/calculator/discount`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** POST /enterprise-hub/cheques/calculator/selection-discount */
export function calculateSelectionDiscountApi(
  payload: { chequeIds: number[]; annualRatePercent: number; baseDate?: string },
  signal?: AbortSignal,
): Promise<ServerDiscountResult> {
  return apiRequest<ServerDiscountResult>(`${CHEQUES_ENDPOINT}/calculator/selection-discount`, {
    method: "POST",
    body: payload,
    signal,
  });
}
