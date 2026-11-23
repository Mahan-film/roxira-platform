import { formatMoneyRial, formatNumber } from "../../lib/fa-format.ts";

/**
 * Format sales money amount (number or string in Rials).
 */
export function formatSalesMoney(amount?: number | string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  return formatMoneyRial(amount);
}

/**
 * Format quantity in standard unit format (up to two decimals).
 */
export function formatSalesQuantity(qty?: number | string | null): string {
  if (qty === null || qty === undefined || qty === "") return "—";
  const num = typeof qty === "number" ? qty : parseFloat(qty);
  return Number.isFinite(num) ? formatNumber(num) : "—";
}
