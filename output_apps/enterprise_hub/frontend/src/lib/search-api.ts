/**
 * Universal entity search API client (Task T147).
 * Connects command palette and search inputs to backend /search endpoint.
 */

import { apiRequest } from '@/lib/api/http-client';
import { API_PROXY_BASE_PATH } from '@/lib/api/config';

export type SearchEntityType =
  | 'customer'
  | 'supplier'
  | 'product'
  | 'invoice'
  | 'bill'
  | 'cheque'
  | 'account'
  | 'page';

export interface SearchItem {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string;
  url: string;
  icon?: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  items: SearchItem[];
  latencyMs: number;
}

/**
 * Searches across all organizational entities and platform pages.
 */
export async function searchUniversal(
  query: string,
  options?: {
    signal?: AbortSignal;
    limit?: number;
    types?: SearchEntityType[];
    baseUrl?: string;
  },
): Promise<SearchItem[]> {
  const q = query.trim();
  if (!q) return [];

  const limit = options?.limit ?? 20;
  const searchParams: Record<string, string | number | undefined> = {
    q,
    limit,
  };

  const endpoint = options?.baseUrl
    ? `${options.baseUrl}/search`
    : `${API_PROXY_BASE_PATH}/search`;

  try {
    const data = await apiRequest<SearchResponse>(endpoint, {
      method: 'GET',
      searchParams,
      signal: options?.signal,
    });
    return data?.items || [];
  } catch {
    return [];
  }
}

/**
 * Maps entity type to Persian display label for category headers.
 */
export function getEntityTypeLabelFa(type: SearchEntityType): string {
  switch (type) {
    case 'page':
      return 'صفحات و امکانات';
    case 'customer':
      return 'مشتریان';
    case 'supplier':
      return 'تأمین‌کنندگان';
    case 'product':
      return 'کالاها و خدمات';
    case 'invoice':
      return 'صورتحساب‌های فروش';
    case 'bill':
      return 'فاکتورهای خرید';
    case 'cheque':
      return 'چک‌ها و اسناد دریافتنی/پرداختنی';
    case 'account':
      return 'حساب‌های دفتر کل';
    default:
      return 'سایر';
  }
}
