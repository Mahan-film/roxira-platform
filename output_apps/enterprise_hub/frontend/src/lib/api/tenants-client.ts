import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, TENANTS_RESOURCE_PATH } from "@/lib/api/config";
import type {
  AddTenantMemberDto,
  TenantMe,
  TenantMember,
} from "@/types/tenants";

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

/** فهرست اعضای سازمان (فقط مالک) — GET /tenants/members */
export async function listTenantMembers(
  signal?: AbortSignal,
): Promise<TenantMember[]> {
  return apiRequest<TenantMember[]>(`${TENANTS_ENDPOINT}/members`, {
    method: "GET",
    signal,
  });
}

/** افزودن عضو به سازمان — POST /tenants/members */
export async function addTenantMember(
  payload: AddTenantMemberDto,
  signal?: AbortSignal,
): Promise<TenantMember> {
  return apiRequest<TenantMember>(`${TENANTS_ENDPOINT}/members`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** حذف عضو از سازمان — DELETE /tenants/members/:userId */
export async function removeTenantMember(
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(
    `${TENANTS_ENDPOINT}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE", signal },
  );
}
