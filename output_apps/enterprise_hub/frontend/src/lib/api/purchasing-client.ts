import {
  AcceptSupplierInvoiceDto,
  ConvertPurchaseRequestDto,
  CreateGoodsReceiptDto,
  CreateLandedCostDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  CreateSupplierInvoiceDto,
  GoodsReceipt,
  LandedCost,
  PurchaseOrder,
  PurchaseRequest,
  PurchaseSettings,
  QueryPurchaseOrdersDto,
  SupplierInvoice,
  UpdatePurchaseSettingsDto,
} from '@/types/purchasing';
import { apiRequest } from '@/lib/api/http-client';
import {
  API_PROXY_BASE_PATH,
  INVENTORY_RESOURCE_PATH,
} from '@/lib/api/config';

const PURCHASING_ENDPOINT = `${API_PROXY_BASE_PATH}/${INVENTORY_RESOURCE_PATH}/purchasing`;

// ----------------------------------------------------------------- requests

export async function listPurchaseRequests(
  signal?: AbortSignal,
): Promise<PurchaseRequest[]> {
  return apiRequest<PurchaseRequest[]>(`${PURCHASING_ENDPOINT}/requests`, {
    method: 'GET',
    signal,
  });
}

export async function createPurchaseRequest(
  payload: CreatePurchaseRequestDto,
  signal?: AbortSignal,
): Promise<PurchaseRequest> {
  return apiRequest<PurchaseRequest>(`${PURCHASING_ENDPOINT}/requests`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export async function convertPurchaseRequest(
  id: string,
  payload: ConvertPurchaseRequestDto,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(
    `${PURCHASING_ENDPOINT}/requests/${encodeURIComponent(id)}/convert`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

export async function cancelPurchaseRequest(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseRequest> {
  return apiRequest<PurchaseRequest>(
    `${PURCHASING_ENDPOINT}/requests/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      signal,
    },
  );
}

// ------------------------------------------------------------------- orders

export async function listPurchaseOrders(
  query?: QueryPurchaseOrdersDto,
  signal?: AbortSignal,
): Promise<PurchaseOrder[]> {
  const params = new URLSearchParams();
  if (query?.status) {
    params.set('status', query.status);
  }
  const qs = params.toString();
  const url = qs ? `${PURCHASING_ENDPOINT}/orders?${qs}` : `${PURCHASING_ENDPOINT}/orders`;
  return apiRequest<PurchaseOrder[]>(url, {
    method: 'GET',
    signal,
  });
}

export async function createPurchaseOrder(
  payload: CreatePurchaseOrderDto,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(`${PURCHASING_ENDPOINT}/orders`, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export async function getPurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export async function approvePurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(id)}/approve`,
    {
      method: 'POST',
      signal,
    },
  );
}

export async function cancelPurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      signal,
    },
  );
}

export async function closePurchaseOrder(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrder> {
  return apiRequest<PurchaseOrder>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(id)}/close`,
    {
      method: 'POST',
      signal,
    },
  );
}

// ----------------------------------------------------------------- receipts

export async function createGoodsReceipt(
  orderId: string,
  payload: CreateGoodsReceiptDto,
  signal?: AbortSignal,
): Promise<GoodsReceipt> {
  return apiRequest<GoodsReceipt>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(orderId)}/receipts`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

export async function listGoodsReceipts(
  orderId?: string,
  signal?: AbortSignal,
): Promise<GoodsReceipt[]> {
  const params = new URLSearchParams();
  if (orderId) {
    params.set('orderId', orderId);
  }
  const qs = params.toString();
  const url = qs
    ? `${PURCHASING_ENDPOINT}/receipts?${qs}`
    : `${PURCHASING_ENDPOINT}/receipts`;
  return apiRequest<GoodsReceipt[]>(url, {
    method: 'GET',
    signal,
  });
}

export async function getGoodsReceipt(
  id: string,
  signal?: AbortSignal,
): Promise<GoodsReceipt> {
  return apiRequest<GoodsReceipt>(
    `${PURCHASING_ENDPOINT}/receipts/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      signal,
    },
  );
}

// -------------------------------------------------------- supplier invoices

export async function createSupplierInvoice(
  orderId: string,
  payload: CreateSupplierInvoiceDto,
  signal?: AbortSignal,
): Promise<SupplierInvoice> {
  return apiRequest<SupplierInvoice>(
    `${PURCHASING_ENDPOINT}/orders/${encodeURIComponent(orderId)}/invoices`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

export async function listSupplierInvoices(
  signal?: AbortSignal,
): Promise<SupplierInvoice[]> {
  return apiRequest<SupplierInvoice[]>(`${PURCHASING_ENDPOINT}/invoices`, {
    method: 'GET',
    signal,
  });
}

export async function getSupplierInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<SupplierInvoice> {
  return apiRequest<SupplierInvoice>(
    `${PURCHASING_ENDPOINT}/invoices/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export async function acceptSupplierInvoice(
  id: string,
  payload: AcceptSupplierInvoiceDto,
  signal?: AbortSignal,
): Promise<SupplierInvoice> {
  return apiRequest<SupplierInvoice>(
    `${PURCHASING_ENDPOINT}/invoices/${encodeURIComponent(id)}/accept`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

export async function postSupplierInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<SupplierInvoice> {
  return apiRequest<SupplierInvoice>(
    `${PURCHASING_ENDPOINT}/invoices/${encodeURIComponent(id)}/post`,
    {
      method: 'POST',
      signal,
    },
  );
}

// ------------------------------------------------------------- landed costs

export async function createLandedCost(
  receiptId: string,
  payload: CreateLandedCostDto,
  signal?: AbortSignal,
): Promise<LandedCost> {
  return apiRequest<LandedCost>(
    `${PURCHASING_ENDPOINT}/receipts/${encodeURIComponent(receiptId)}/landed-costs`,
    {
      method: 'POST',
      body: payload,
      signal,
    },
  );
}

// ----------------------------------------------------------------- settings

export async function getPurchaseSettings(
  signal?: AbortSignal,
): Promise<PurchaseSettings> {
  return apiRequest<PurchaseSettings>(`${PURCHASING_ENDPOINT}/settings`, {
    method: 'GET',
    signal,
  });
}

export async function updatePurchaseSettings(
  payload: UpdatePurchaseSettingsDto,
  signal?: AbortSignal,
): Promise<PurchaseSettings> {
  return apiRequest<PurchaseSettings>(`${PURCHASING_ENDPOINT}/settings`, {
    method: 'PUT',
    body: payload,
    signal,
  });
}
