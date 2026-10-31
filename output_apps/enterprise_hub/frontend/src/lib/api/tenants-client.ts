import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, TENANTS_RESOURCE_PATH } from "@/lib/api/config";
import type { TenantMe } from "@/types/tenants";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS رخ
// ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const TENANTS_ENDPOINT = `${API_PROXY_BASE_PATH}/${TENANTS_RESOURCE_PATH}`;

/** سازمان جاری کاربر — GET /tenants/me */
export async function getMyTenant(signal?: AbortSignal): Promise<TenantMe> {
  return apiRequest<TenantMe>(`${TENANTS_ENDPOINT}/me`, {
    method: "GET",
    signal,
  });
}
