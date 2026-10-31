import { apiDownload, apiRequest, apiUpload } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, BANKING_RESOURCE_PATH } from "@/lib/api/config";

const RECON = `${API_PROXY_BASE_PATH}/${BANKING_RESOURCE_PATH}/recon`;

export interface ReconCheck {
  code: string;
  severity: "ok" | "warn" | "ask" | "block";
  message: string;
  evidence: string[];
  choices: Array<{ id: string; label: string }>;
}

export interface ReconSession {
  id: number;
  status: string;
  fileName: string;
  bankAccountId: number | null;
  period: { from: string; to: string } | null;
  header: Record<string, unknown>;
  checks: ReconCheck[];
  rowCount?: number;
  skippedRows?: Array<{ rowNo: number; reason: string }>;
  offerCreateAccount?: boolean;
  mapping?: {
    reason: string;
    headers: string[];
    suggestedMap: Record<string, number>;
    sampleRows: string[][];
  };
}

export interface ReconItem {
  id: number;
  date: string;
  description: string;
  withdrawalRial: string;
  depositRial: string;
  category: string | null;
  counterparty: string | null;
  status: string;
  needsAccount?: boolean;
  draft?: ReconDraft | null;
}

export interface ReconDraft {
  id: number;
  itemId: number;
  date: string;
  description: string;
  amountRial: string;
  direction: "in" | "out";
  counterAccountCode: string;
  category: string;
  status: string;
  auto: boolean;
  journalEntryId: number | null;
  failureReason: string | null;
}

export interface ReconQuestion {
  kind: "classify" | "confirm_match";
  itemId: number;
  text: string;
  choices: Array<{ id: string; label: string; category?: string }>;
  evidence: string[];
  groupId?: string;
}

export interface ReconReview {
  session: ReconSession;
  matched: unknown[];
  suggested: unknown[];
  unmatched: ReconItem[];
  drafts: ReconDraft[];
  questions: ReconQuestion[];
  counts: { matched: number; suggested: number; unmatched: number; drafts: number };
}

export interface ReconSettings {
  feeMaxRial: string;
  smsFeeMaxRial: string;
  autoPostFees: boolean;
  autoMatchMinConfidence: number;
  dateWindowDays: number;
  categoryAccounts: Record<string, string>;
}

export interface ReconReport {
  id: number;
  report: { difference?: string };
}

const post = <T>(path: string, body?: unknown) =>
  apiRequest<T>(`${RECON}/${path}`, { method: "POST", body: body ?? {} });

export function uploadStatement(file: File, bankAccountId?: number): Promise<ReconSession> {
  const form = new FormData();
  form.append("file", file);
  const query = bankAccountId ? `?bankAccountId=${bankAccountId}` : "";
  return apiUpload<ReconSession>(`${RECON}/sessions${query}`, form);
}

export const listSessions = () => apiRequest<ReconSession[]>(`${RECON}/sessions`, { method: "GET" });
export const getSession = (id: number) => apiRequest<ReconSession>(`${RECON}/sessions/${id}`, { method: "GET" });
export const getReview = (id: number) => apiRequest<ReconReview>(`${RECON}/sessions/${id}/review`, { method: "GET" });
export const answerCheck = (id: number, code: string, choice: string) =>
  post<ReconSession>(`sessions/${id}/answers`, { code, choice });
export const submitMapping = (id: number, columnMap: Record<string, number>) =>
  post<ReconSession>(`sessions/${id}/mapping`, { columnMap });
export const createAccountFromSession = (id: number, name: string, ledgerAccountId: number) =>
  post<ReconSession>(`sessions/${id}/create-account`, { name, ledgerAccountId });
export const commitSession = (id: number) => post<ReconReview>(`sessions/${id}/commit`);
export const rerunSession = (id: number) => post<ReconReview>(`sessions/${id}/rematch`);
export const decideMatch = (id: number, groupId: string, accept: boolean) =>
  post<ReconReview>(`sessions/${id}/matches/${encodeURIComponent(groupId)}`, { accept });
export const answerQuestion = (
  itemId: number,
  body: { choiceId: string; counterAccountCode?: string; remember?: boolean },
) => post<{ draft: ReconDraft | null }>(`items/${itemId}/answer`, body);
export const approveDrafts = (draftIds: number[]) =>
  post<Array<{ id: number; status: string; reason?: string }>>("drafts/approve", { draftIds });
export const rejectDraft = (id: number) => post<ReconDraft>(`drafts/${id}/reject`);
export const buildReport = (id: number) => post<ReconReport>(`sessions/${id}/report`);
export const downloadReport = (reportId: number, format: "xlsx" | "csv" | "html") =>
  apiDownload(`${RECON}/reports/${reportId}?format=${format}`);
export const getReconSettings = () => apiRequest<ReconSettings>(`${RECON}/settings`, { method: "GET" });
export const updateReconSettings = (body: Partial<ReconSettings>) =>
  apiRequest<ReconSettings>(`${RECON}/settings`, { method: "PUT", body });
