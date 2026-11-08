import { apiRequest } from "./http-client";
import { API_PROXY_BASE_PATH, TREASURY_RESOURCE_PATH } from "./config";
import type {
  QueryTreasuryDocuments,
  TreasuryDocument,
  TreasuryDocumentDetail,
} from "../../types/treasury";

const BASE = `${API_PROXY_BASE_PATH}/${TREASURY_RESOURCE_PATH}`;

export async function listTreasuryDocuments(
  query?: QueryTreasuryDocuments,
  signal?: AbortSignal,
): Promise<TreasuryDocument[]> {
  const searchParams: Record<string, string> = {};
  if (query?.kind) searchParams.kind = query.kind;
  if (query?.partyCode) searchParams.partyCode = query.partyCode;
  if (query?.from) searchParams.from = query.from;
  if (query?.to) searchParams.to = query.to;

  return apiRequest<TreasuryDocument[]>(`${BASE}/documents`, {
    searchParams,
    signal,
  });
}

export async function getTreasuryDocument(
  id: number,
  signal?: AbortSignal,
): Promise<TreasuryDocumentDetail> {
  return apiRequest<TreasuryDocumentDetail>(`${BASE}/documents/${id}`, {
    signal,
  });
}
