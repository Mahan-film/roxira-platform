import { API_PROXY_BASE_PATH } from '@/lib/api/config';
import { apiRequest } from '@/lib/api/http-client';
import type {
  UpdateWooCommerceConfigInput,
  WooCommerceConfig,
  WooCommerceSyncLog,
} from '@/types/woocommerce';

const WOO_BASE = `${API_PROXY_BASE_PATH}/api/integrations/woocommerce`;

export async function getWooCommerceConfig(signal?: AbortSignal): Promise<WooCommerceConfig> {
  return apiRequest<WooCommerceConfig>(`${WOO_BASE}/config`, {
    method: 'GET',
    signal,
  });
}

export async function updateWooCommerceConfig(
  input: UpdateWooCommerceConfigInput,
  signal?: AbortSignal,
): Promise<WooCommerceConfig> {
  return apiRequest<WooCommerceConfig>(`${WOO_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

export async function getWooCommerceLogs(
  params?: { direction?: string; status?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
): Promise<{ items: WooCommerceSyncLog[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.direction) query.set('direction', params.direction);
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  const url = `${WOO_BASE}/logs${query.toString() ? `?${query.toString()}` : ''}`;
  return apiRequest<{ items: WooCommerceSyncLog[]; total: number }>(url, {
    method: 'GET',
    signal,
  });
}
