import { apiRequest } from "@/lib/api/http-client";
import { ACCOUNTING_RESOURCE_PATH, API_PROXY_BASE_PATH } from "@/lib/api/config";
import type {
  CreateDimensionInput,
  Dimension,
  DimensionBalanceRow,
  DimensionKind,
} from "@/types/dimension";

const DIMENSIONS_ENDPOINT = `${API_PROXY_BASE_PATH}/${ACCOUNTING_RESOURCE_PATH}/dimensions`;

/** List floating details, cost centres or project centres. */
export async function listDimensions(
  kind?: DimensionKind,
  signal?: AbortSignal,
): Promise<Dimension[]> {
  const url = kind ? `${DIMENSIONS_ENDPOINT}?kind=${encodeURIComponent(kind)}` : DIMENSIONS_ENDPOINT;
  return apiRequest<Dimension[]>(url, {
    method: "GET",
    signal,
  });
}

/** Create a new dimension (detail, cost center, or project). */
export async function createDimension(
  payload: CreateDimensionInput,
  signal?: AbortSignal,
): Promise<Dimension> {
  return apiRequest<Dimension>(DIMENSIONS_ENDPOINT, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** Get turnover and balance for dimensions of a specific kind in a date range. */
export async function getDimensionBalances(
  kind: DimensionKind,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<DimensionBalanceRow[]> {
  const query = new URLSearchParams({ from, to }).toString();
  return apiRequest<DimensionBalanceRow[]>(`${DIMENSIONS_ENDPOINT}/${encodeURIComponent(kind)}/balances?${query}`, {
    method: "GET",
    signal,
  });
}
