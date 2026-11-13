import { apiRequest } from '@/lib/api/http-client';
import { API_PROXY_BASE_PATH, SALES_RESOURCE_PATH } from '@/lib/api/config';
import type {
  ConvertQuotationToInvoiceDto,
  ConvertQuotationToInvoiceResponseDto,
  CreateQuotationDto,
  QuotationListResponseDto,
  SalesQuotationResponseDto,
} from '@/types/quotation';

const SALES_ENDPOINT = `${API_PROXY_BASE_PATH}/${SALES_RESOURCE_PATH}`;

export async function listQuotations(
  params: { partyCode?: string; status?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<QuotationListResponseDto> {
  const q = new URLSearchParams();
  if (params.partyCode) q.set('partyCode', params.partyCode);
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));

  const url = `${SALES_ENDPOINT}/quotations${q.toString() ? `?${q.toString()}` : ''}`;
  return apiRequest<QuotationListResponseDto>(url, { method: 'GET', signal });
}

export async function getQuotation(
  id: number,
  signal?: AbortSignal,
): Promise<SalesQuotationResponseDto> {
  return apiRequest<SalesQuotationResponseDto>(`${SALES_ENDPOINT}/quotations/${id}`, {
    method: 'GET',
    signal,
  });
}

export async function createQuotation(
  payload: CreateQuotationDto,
  signal?: AbortSignal,
): Promise<SalesQuotationResponseDto> {
  return apiRequest<SalesQuotationResponseDto>(`${SALES_ENDPOINT}/quotations`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

/**
 * 1-Click conversion from quotation to sales invoice (T104).
 */
export async function convertQuotationToInvoice(
  quotationId: number,
  dto?: ConvertQuotationToInvoiceDto,
  signal?: AbortSignal,
): Promise<ConvertQuotationToInvoiceResponseDto> {
  return apiRequest<ConvertQuotationToInvoiceResponseDto>(
    `${SALES_ENDPOINT}/quotations/${quotationId}/convert-to-invoice`,
    {
      method: 'POST',
      body: dto ?? {},
      signal,
    },
  );
}
