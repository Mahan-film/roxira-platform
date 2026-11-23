import { apiRequest } from "./http-client";
import { API_PROXY_BASE_PATH, API_TOKENS_RESOURCE_PATH } from "./config";
import type {
  ApiTokenView,
  CreateApiTokenPayload,
  CreatedApiTokenView,
} from "@/types/api-tokens";

const BASE_URL = `${API_PROXY_BASE_PATH}/${API_TOKENS_RESOURCE_PATH}`;

/**
 * دریافت فهرست توکن‌های API سازمان (بدون خود توکن خام).
 */
export async function listApiTokens(signal?: AbortSignal): Promise<ApiTokenView[]> {
  return apiRequest<ApiTokenView[]>(BASE_URL, { signal });
}

/**
 * ساخت توکن API جدید.
 * توکن خام فقط همین یک بار در پاسخ بازگردانده می‌شود و در هیچ‌جای دیگر در دسترس نخواهد بود.
 */
export async function createApiToken(
  payload: CreateApiTokenPayload,
  signal?: AbortSignal,
): Promise<CreatedApiTokenView> {
  return apiRequest<CreatedApiTokenView>(BASE_URL, {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * ابطال دائمی یک توکن API (غیرقابل بازگشت).
 */
export async function revokeApiToken(id: number, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(`${BASE_URL}/${id}`, {
    method: "DELETE",
    signal,
  });
}
