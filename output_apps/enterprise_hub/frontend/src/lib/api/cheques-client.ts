import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, CHEQUES_RESOURCE_PATH } from "@/lib/api/config";
import type {
  Cheque,
  ChequeDirection,
  ChequeStatus,
  CreateChequeDto,
  DueCheques,
  TransitionChequeDto,
} from "@/types/cheques";

// Same-origin proxy (next.config.ts rewrites); the NestJS origin never reaches the browser.
const CHEQUES_ENDPOINT = `${API_PROXY_BASE_PATH}/${CHEQUES_RESOURCE_PATH}`;

/** GET /enterprise-hub/cheques */
export function listCheques(
  params: { direction?: ChequeDirection; status?: ChequeStatus } = {},
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

/** POST /enterprise-hub/cheques/:id/transition */
export function transitionCheque(
  id: number,
  payload: TransitionChequeDto,
  signal?: AbortSignal,
): Promise<Cheque> {
  return apiRequest<Cheque>(`${CHEQUES_ENDPOINT}/${id}/transition`, {
    method: "POST",
    body: payload,
    signal,
  });
}
