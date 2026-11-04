import { API_PROXY_BASE_PATH } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";

/** Settings of the posting rules engine: GET/PUT/DELETE /enterprise-hub/posting-rules. */
const BASE = `${API_PROXY_BASE_PATH}/posting-rules`;

export interface PostingRoleRow {
  role: string;
  label: string;
  types: string[];
  accountCode: string | null;
  accountName: string | null;
  source: "document" | "all" | "default";
  valid: boolean;
}

export interface PostingTemplateRow {
  docType: string;
  title: string;
  roles: PostingRoleRow[];
}

export const listPostingRules = (signal?: AbortSignal) => apiRequest<PostingTemplateRow[]>(BASE, { signal });

export const setPostingRole = (docType: string, role: string, accountCode: string) =>
  apiRequest<void>(`${BASE}/${encodeURIComponent(docType)}/roles/${encodeURIComponent(role)}`, { method: "PUT", body: { accountCode } });

export const clearPostingRole = (docType: string, role: string) =>
  apiRequest<void>(`${BASE}/${encodeURIComponent(docType)}/roles/${encodeURIComponent(role)}`, { method: "DELETE" });
