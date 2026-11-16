/**
 * Universal entity search API client (Task T147).
 * Connects command palette and search inputs to backend /search endpoint.
 */

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

  const baseUrl = options?.baseUrl ?? '';
  const limit = options?.limit ?? 20;
  const params = new URLSearchParams({ q, limit: String(limit) });

  if (options?.types && options.types.length > 0) {
    for (const t of options.types) {
      params.append('types[]', t);
    }
  }

  try {
    const res = await fetch(`${baseUrl}/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: options?.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as SearchResponse;
    return data.items || [];
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return [];
    }
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
