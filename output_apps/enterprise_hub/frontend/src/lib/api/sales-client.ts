import {
  ChangeSalesQuotationStatusDto,
  ConvertQuotationDto,
  CreatePriceTierDto,
  CreateSalesDeliveryDto,
  CreateSalesOrderDto,
  CreateSalesQuotationDto,
  ListPriceTiersQueryDto,
  OrderFulfilmentResponse,
  PriceTier,
  QuerySalesOrderDto,
  QuerySalesQuotationDto,
  SalesDelivery,
  SalesDeliveryListResponse,
  SalesOrder,
  SalesOrderListResponse,
  SalesQuotation,
  SalesQuotationListResponse,
  SalesQuotationStatus,
} from '@/types/sales';
import { apiRequest } from '@/lib/api/http-client';
import { API_PROXY_BASE_PATH } from '@/lib/api/config';

const SALES_ENDPOINT = `${API_PROXY_BASE_PATH}/enterprise-hub/sales`;

// ------------------------------------------------------------------- orders

export async function listSalesOrders(
  query?: QuerySalesOrderDto,
  signal?: AbortSignal,
): Promise<SalesOrderListResponse> {
  const params = new URLSearchParams();
  if (query?.partyCode) params.set('partyCode', query.partyCode);
  if (query?.status) params.set('status', query.status);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  const url = qs ? `${SALES_ENDPOINT}/orders?${qs}` : `${SALES_ENDPOINT}/orders`;
  return apiRequest<SalesOrderListResponse>(url, { method: 'GET', signal });
}

export async function getSalesOrder(
  id: number,
  signal?: AbortSignal,
): Promise<SalesOrder> {
  return apiRequest<SalesOrder>(`${SALES_ENDPOINT}/orders/${id}`, {
    method: 'GET',
    signal,
  });
}

export async function createSalesOrder(
  payload: CreateSalesOrderDto,
  signal?: AbortSignal,
): Promise<SalesOrder> {
  return apiRequest<SalesOrder>(`${SALES_ENDPOINT}/orders`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export async function confirmSalesOrder(
  id: number,
  signal?: AbortSignal,
): Promise<SalesOrder> {
  return apiRequest<SalesOrder>(`${SALES_ENDPOINT}/orders/${id}/confirm`, {
    method: 'POST',
    signal,
  });
}

export async function cancelSalesOrder(
  id: number,
  signal?: AbortSignal,
): Promise<SalesOrder> {
  return apiRequest<SalesOrder>(`${SALES_ENDPOINT}/orders/${id}/cancel`, {
    method: 'POST',
    signal,
  });
}

export async function getOrderFulfilment(
  orderId: number,
  signal?: AbortSignal,
): Promise<OrderFulfilmentResponse> {
  return apiRequest<OrderFulfilmentResponse>(
    `${SALES_ENDPOINT}/orders/${orderId}/fulfilment`,
    {
      method: 'GET',
      signal,
    },
  );
}

// ---------------------------------------------------------------- quotations

export async function listSalesQuotations(
  query?: QuerySalesQuotationDto,
  signal?: AbortSignal,
): Promise<SalesQuotationListResponse> {
  const params = new URLSearchParams();
  if (query?.partyCode) params.set('partyCode', query.partyCode);
  if (query?.status) params.set('status', query.status);
  if (query?.limit !== undefined) params.set('limit', String(query.limit));
  if (query?.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  const url = qs ? `${SALES_ENDPOINT}/quotations?${qs}` : `${SALES_ENDPOINT}/quotations`;
  return apiRequest<SalesQuotationListResponse>(url, { method: 'GET', signal });
}

export async function getSalesQuotation(
  id: number,
  signal?: AbortSignal,
): Promise<SalesQuotation> {
  return apiRequest<SalesQuotation>(`${SALES_ENDPOINT}/quotations/${id}`, {
    method: 'GET',
    signal,
  });
}

export async function createSalesQuotation(
  payload: CreateSalesQuotationDto,
  signal?: AbortSignal,
): Promise<SalesQuotation> {
  return apiRequest<SalesQuotation>(`${SALES_ENDPOINT}/quotations`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export async function changeQuotationStatus(
  id: number,
  status: SalesQuotationStatus,
  signal?: AbortSignal,
): Promise<SalesQuotation> {
  return apiRequest<SalesQuotation>(`${SALES_ENDPOINT}/quotations/${id}/status`, {
    method: 'POST',
    body: { status },
    signal,
  });
}

export async function convertQuotation(
  id: number,
  payload: ConvertQuotationDto,
  signal?: AbortSignal,
): Promise<SalesOrder> {
  return apiRequest<SalesOrder>(`${SALES_ENDPOINT}/quotations/${id}/convert`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

// --------------------------------------------------------------- deliveries

export async function listSalesDeliveries(
  orderId?: number,
  signal?: AbortSignal,
): Promise<SalesDeliveryListResponse> {
  const params = new URLSearchParams();
  if (orderId) params.set('orderId', String(orderId));
  const qs = params.toString();
  const url = qs ? `${SALES_ENDPOINT}/deliveries?${qs}` : `${SALES_ENDPOINT}/deliveries`;
  return apiRequest<SalesDeliveryListResponse>(url, { method: 'GET', signal });
}

export async function getSalesDelivery(
  id: number,
  signal?: AbortSignal,
): Promise<SalesDelivery> {
  return apiRequest<SalesDelivery>(`${SALES_ENDPOINT}/deliveries/${id}`, {
    method: 'GET',
    signal,
  });
}

export async function createSalesDelivery(
  orderId: number,
  payload: CreateSalesDeliveryDto,
  signal?: AbortSignal,
): Promise<SalesDelivery> {
  return apiRequest<SalesDelivery>(
    `${SALES_ENDPOINT}/orders/${orderId}/deliveries`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

// -------------------------------------------------------------- price tiers

export async function listPriceTiers(
  query?: ListPriceTiersQueryDto,
  signal?: AbortSignal,
): Promise<PriceTier[]> {
  const params = new URLSearchParams();
  if (query?.sku) params.set('sku', query.sku);
  if (query?.customerGroup) params.set('customerGroup', query.customerGroup);
  const qs = params.toString();
  const url = qs ? `${SALES_ENDPOINT}/price-tiers?${qs}` : `${SALES_ENDPOINT}/price-tiers`;
  return apiRequest<PriceTier[]>(url, { method: 'GET', signal });
}

export async function createPriceTier(
  payload: CreatePriceTierDto,
  signal?: AbortSignal,
): Promise<PriceTier> {
  return apiRequest<PriceTier>(`${SALES_ENDPOINT}/price-tiers`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export async function deletePriceTier(
  id: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(`${SALES_ENDPOINT}/price-tiers/${id}`, {
    method: 'DELETE',
    signal,
  });
}
