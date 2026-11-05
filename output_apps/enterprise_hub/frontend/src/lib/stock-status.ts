/** Status of a stock item based on quantity and isLowStock flag. */
export type StockStatus = "empty" | "low" | "ok";

/** Determine stock status: empty when quantity <= 0; low when isLowStock (and not empty); ok otherwise. */
export function stockStatus(item: { quantity: number; isLowStock: boolean }): StockStatus {
  if (item.quantity <= 0) return "empty";
  if (item.isLowStock) return "low";
  return "ok";
}

/** Persian labels for stock status messages. */
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  empty: "بدون موجودی",
  low: "زیر نقطهٔ سفارش",
  ok: "کافی",
};
