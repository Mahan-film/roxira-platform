import {
  CreateAdjustmentDto,
  CreateDeliveryDto,
  CreateReceiptDto,
  CreateStoreDto,
  CreateTransferDto,
  StockDocument,
  Store,
  UpdateStoreDto,
  UpdateWarehouseDto,
  CreateStockItemDto,
  CreateWarehouseDto,
  FifoBatch,
  FifoValuationResponse,
  InboundStockDto,
  OutboundStockDto,
  PaginatedStockItemResponse,
  QueryStockItemDto,
  StockItem,
  StockMovementResult,
  UpdateStockItemDto,
  Warehouse,
  WarehouseStockResponse,
} from "@/types/inventory";
import { apiRequest } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  INVENTORY_RESOURCE_PATH,
} from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const INVENTORY_ENDPOINT = `${API_PROXY_BASE_PATH}/${INVENTORY_RESOURCE_PATH}`;

/** ایجاد انبار — POST /enterprise-hub/inventory/warehouses */
export async function createWarehouse(
  payload: CreateWarehouseDto,
  signal?: AbortSignal,
): Promise<Warehouse> {
  return apiRequest<Warehouse>(`${INVENTORY_ENDPOINT}/warehouses`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** فهرست انبارها — GET /enterprise-hub/inventory/warehouses */
export async function listWarehouses(
  signal?: AbortSignal,
): Promise<Warehouse[]> {
  return apiRequest<Warehouse[]>(`${INVENTORY_ENDPOINT}/warehouses`, {
    method: "GET",
    signal,
  });
}

/** استعلام موجودی یک انبار — GET /enterprise-hub/inventory/warehouses/:id/stock */
export async function getWarehouseStock(
  id: number,
  signal?: AbortSignal,
): Promise<WarehouseStockResponse> {
  return apiRequest<WarehouseStockResponse>(
    `${INVENTORY_ENDPOINT}/warehouses/${id}/stock`,
    { method: "GET", signal },
  );
}

/** افزودن کالای جدید — POST /enterprise-hub/inventory/items */
export async function createStockItem(
  payload: CreateStockItemDto,
  signal?: AbortSignal,
): Promise<StockItem> {
  return apiRequest<StockItem>(`${INVENTORY_ENDPOINT}/items`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** فهرست کالاها همراه با هشدار کسری — GET /enterprise-hub/inventory/items */
export async function listStockItems(
  params: QueryStockItemDto = {},
  signal?: AbortSignal,
): Promise<PaginatedStockItemResponse> {
  return apiRequest<PaginatedStockItemResponse>(
    `${INVENTORY_ENDPOINT}/items`,
    {
      method: "GET",
      searchParams: {
        page: params.page,
        limit: params.limit,
        search: params.search,
        lowStockOnly:
          params.lowStockOnly === undefined
            ? undefined
            : String(params.lowStockOnly),
        noStockOnly: params.noStockOnly ? "true" : undefined,
      },
      signal,
    },
  );
}

/** ویرایش کالا — PATCH /enterprise-hub/inventory/items/:id */
export async function updateStockItem(
  id: number,
  payload: UpdateStockItemDto,
  signal?: AbortSignal,
): Promise<StockItem> {
  return apiRequest<StockItem>(`${INVENTORY_ENDPOINT}/items/${id}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** لایه‌های FIFO باز یک کالا — GET /enterprise-hub/inventory/items/:sku/batches */
export async function listStockItemBatches(
  sku: string,
  signal?: AbortSignal,
): Promise<FifoBatch[]> {
  return apiRequest<FifoBatch[]>(
    `${INVENTORY_ENDPOINT}/items/${encodeURIComponent(sku)}/batches`,
    { method: "GET", signal },
  );
}

/** ورود کالا به انبار — POST /enterprise-hub/inventory/movements/inbound */
export async function receiveStock(
  payload: InboundStockDto,
  signal?: AbortSignal,
): Promise<StockMovementResult> {
  return apiRequest<StockMovementResult>(
    `${INVENTORY_ENDPOINT}/movements/inbound`,
    {
      method: "POST",
      body: payload,
      signal,
    },
  );
}

/** خروج کالا از انبار با FIFO — POST /enterprise-hub/inventory/movements/outbound */
export async function issueStock(
  payload: OutboundStockDto,
  signal?: AbortSignal,
): Promise<StockMovementResult> {
  return apiRequest<StockMovementResult>(
    `${INVENTORY_ENDPOINT}/movements/outbound`,
    {
      method: "POST",
      body: payload,
      signal,
    },
  );
}

/** گزارش ارزش موجودی بر پایه FIFO — GET /enterprise-hub/inventory/valuation */
export async function getFifoValuation(
  signal?: AbortSignal,
): Promise<FifoValuationResponse> {
  return apiRequest<FifoValuationResponse>(
    `${INVENTORY_ENDPOINT}/valuation`,
    { method: "GET", signal },
  );
}

/** فهرست فروشگاه‌ها — GET /enterprise-hub/inventory/stores */
export async function listStores(signal?: AbortSignal): Promise<Store[]> {
  return apiRequest<Store[]>(`${INVENTORY_ENDPOINT}/stores`, { method: "GET", signal });
}

export async function createStore(payload: CreateStoreDto): Promise<Store> {
  return apiRequest<Store>(`${INVENTORY_ENDPOINT}/stores`, { method: "POST", body: payload });
}

export async function updateStore(id: number, payload: UpdateStoreDto): Promise<Store> {
  return apiRequest<Store>(`${INVENTORY_ENDPOINT}/stores/${id}`, { method: "PATCH", body: payload });
}

/** ویرایش انبار — PATCH /enterprise-hub/inventory/warehouses/:id */
export async function updateWarehouse(id: number, payload: UpdateWarehouseDto): Promise<Warehouse> {
  return apiRequest<Warehouse>(`${INVENTORY_ENDPOINT}/warehouses/${id}`, { method: "PATCH", body: payload });
}

/** انتقال بین دو انبار — POST /enterprise-hub/inventory/documents/transfers */
export async function createTransfer(payload: CreateTransferDto): Promise<StockDocument> {
  return apiRequest<StockDocument>(`${INVENTORY_ENDPOINT}/documents/transfers`, { method: "POST", body: payload });
}

/** اسناد انبار — GET /enterprise-hub/inventory/documents */
export async function listStockDocuments(
  params: { page?: number; limit?: number; docType?: string; warehouseId?: number } = {},
  signal?: AbortSignal,
): Promise<{ data: StockDocument[]; total: number; page: number; limit: number }> {
  return apiRequest(`${INVENTORY_ENDPOINT}/documents`, {
    method: "GET",
    searchParams: params,
    signal,
  });
}

export async function createReceipt(payload: CreateReceiptDto): Promise<StockDocument> {
  return apiRequest<StockDocument>(`${INVENTORY_ENDPOINT}/documents/receipts`, { method: "POST", body: payload });
}

export async function createDelivery(payload: CreateDeliveryDto): Promise<StockDocument> {
  return apiRequest<StockDocument>(`${INVENTORY_ENDPOINT}/documents/deliveries`, { method: "POST", body: payload });
}

export async function createAdjustment(payload: CreateAdjustmentDto): Promise<StockDocument> {
  return apiRequest<StockDocument>(`${INVENTORY_ENDPOINT}/documents/adjustments`, { method: "POST", body: payload });
}

export async function getStockDocument(id: number, signal?: AbortSignal): Promise<StockDocument> {
  return apiRequest<StockDocument>(`${INVENTORY_ENDPOINT}/documents/${id}`, { method: "GET", signal });
}
