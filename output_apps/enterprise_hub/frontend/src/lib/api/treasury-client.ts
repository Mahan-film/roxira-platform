import { apiRequest } from "./http-client";
import { API_PROXY_BASE_PATH, TREASURY_RESOURCE_PATH } from "./config";
import type {
  ConfirmTreasurySmsDraftDto,
  CreateTreasuryDocumentDto,
  OpenInvoice,
  QueryTreasuryDocuments,
  TreasuryDocKind,
  TreasuryDocument,
  TreasuryDocumentDetail,
  TreasurySmsDraft,
} from "../../types/treasury";

const BASE = `${API_PROXY_BASE_PATH}/${TREASURY_RESOURCE_PATH}`;

export async function parseBankSms(
  text: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return apiRequest(`${BASE}/sms/parse`, {
    method: "POST",
    body: { text },
    signal,
  });
}

export async function captureBankSms(
  text: string,
  signal?: AbortSignal,
): Promise<TreasurySmsDraft> {
  return apiRequest<TreasurySmsDraft>(`${BASE}/sms/capture`, {
    method: "POST",
    body: { text },
    signal,
  });
}

export async function listTreasurySmsDrafts(
  query?: { status?: string; docKind?: string },
  signal?: AbortSignal,
): Promise<TreasurySmsDraft[]> {
  const searchParams: Record<string, string> = {};
  if (query?.status) searchParams.status = query.status;
  if (query?.docKind) searchParams.docKind = query.docKind;

  return apiRequest<TreasurySmsDraft[]>(`${BASE}/sms/drafts`, {
    searchParams,
    signal,
  });
}

export async function confirmTreasurySmsDraft(
  id: string,
  payload: ConfirmTreasurySmsDraftDto,
  signal?: AbortSignal,
): Promise<TreasuryDocumentDetail> {
  return apiRequest<TreasuryDocumentDetail>(`${BASE}/sms/drafts/${id}/confirm`, {
    method: "POST",
    body: payload,
    signal,
  });
}

export async function rejectTreasurySmsDraft(
  id: string,
  signal?: AbortSignal,
): Promise<TreasurySmsDraft> {
  return apiRequest<TreasurySmsDraft>(`${BASE}/sms/drafts/${id}/reject`, {
    method: "POST",
    signal,
  });
}

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

export async function createTreasuryDocument(
  payload: CreateTreasuryDocumentDto,
  signal?: AbortSignal,
): Promise<TreasuryDocumentDetail> {
  return apiRequest<TreasuryDocumentDetail>(`${BASE}/documents`, {
    method: "POST",
    body: payload,
    signal,
  });
}

export async function getOpenInvoices(
  kind: TreasuryDocKind,
  ids?: string[],
  partyCode?: string,
  signal?: AbortSignal,
): Promise<OpenInvoice[]> {
  const searchParams: Record<string, string> = { kind };
  if (ids && ids.length > 0) {
    searchParams.ids = ids.join(",");
  }
  if (partyCode && partyCode.trim().length > 0) {
    searchParams.partyCode = partyCode.trim();
  }
  return apiRequest<OpenInvoice[]>(`${BASE}/open-invoices`, {
    method: "GET",
    searchParams,
    signal,
  });
}
