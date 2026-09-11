/**
 * تایپ‌های مشترک ماژول انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO.
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/inventory/dto` هستند (Contract-First Synchronization — Rule #4).
 */

export enum StockMovementType {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND",
}

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  [StockMovementType.INBOUND]: "ورود کالا",
  [StockMovementType.OUTBOUND]: "خروج کالا",
};

export interface Warehouse {
  id: number;
  name: string;
  locationCode: string;
  createdAt: string;
}

export interface CreateWarehouseDto {
  name: string;
  locationCode: string;
}

export interface StockItem {
  id: number;
  sku: string;
  barcode: string;
  name: string;
  quantity: number;
  minQuantity: number;
  isLowStock: boolean;
  batchNumber: string | null;
  fifoValuation: number;
}

export interface CreateStockItemDto {
  sku: string;
  barcode: string;
  name: string;
  batchNumber?: string;
  minQuantity?: number;
  quantity?: number;
}

export interface UpdateStockItemDto {
  barcode?: string;
  name?: string;
  batchNumber?: string;
  minQuantity?: number;
}

export interface QueryStockItemDto {
  page?: number;
  limit?: number;
  search?: string;
  lowStockOnly?: boolean;
}

export interface PaginatedStockItemResponse {
  data: StockItem[];
  total: number;
  page: number;
  limit: number;
  lowStockCount: number;
}

export interface FifoBatch {
  id: number;
  sku: string;
  batchNumber: string;
  quantityRemaining: number;
  unitPurchaseCost: number;
  remainingValue: number;
  receivedDate: string;
  warehouseId: number | null;
  warehouseName: string | null;
}

export interface InboundStockDto {
  sku: string;
  quantity: number;
  unitPurchaseCost: number;
  warehouseId?: number;
  batchNumber?: string;
  reference?: string;
}

export interface OutboundStockDto {
  sku: string;
  quantity: number;
  warehouseId?: number;
  reference?: string;
}

export interface MovementLayer {
  batchId: number;
  batchNumber: string;
  quantity: number;
  unitPurchaseCost: number;
  value: number;
  warehouseId: number | null;
}

export interface StockMovementResult {
  type: StockMovementType;
  sku: string;
  quantity: number;
  quantityAfter: number;
  totalCost: number;
  layers: MovementLayer[];
  processedAt: string;
}

export interface WarehouseStockRow {
  sku: string;
  name: string;
  quantity: number;
  fifoValue: number;
  openBatchCount: number;
}

export interface WarehouseStockResponse {
  warehouseId: number;
  warehouseName: string;
  locationCode: string;
  totalValue: number;
  itemCount: number;
  rows: WarehouseStockRow[];
}

export interface FifoValuationRow {
  sku: string;
  name: string;
  quantity: number;
  batchQuantity: number;
  fifoValue: number;
  weightedAverageUnitCost: number;
  openBatchCount: number;
  isLowStock: boolean;
}

export interface FifoValuationResponse {
  itemCount: number;
  lowStockCount: number;
  totalInventoryValue: number;
  totalOpenBatches: number;
  rows: FifoValuationRow[];
}
