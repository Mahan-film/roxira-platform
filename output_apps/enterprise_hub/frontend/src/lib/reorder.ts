import { foldDigits } from "./csv.ts";

/** The fields of a stock item the reorder list needs. */
export interface ReorderItem {
  sku: string;
  barcode: string;
  name: string;
  quantity: number;
  minQuantity: number;
}

/**
 * Units to order to get back to the minimum: max(0, minimum − on hand), rounded to 2 decimals
 * (quantities have at most 2 decimals on the server). An item exactly at its minimum is on the
 * list (the server uses `quantity <= minQuantity`) with a shortfall of 0.
 */
export function shortfall(item: Pick<ReorderItem, "quantity" | "minQuantity">): number {
  const gap = Math.round((item.minQuantity - item.quantity) * 100) / 100;
  return gap > 0 ? gap : 0;
}

/** Largest shortfall first, then by SKU, so the most urgent item is on top. */
export function sortByShortfall<T extends ReorderItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => shortfall(b) - shortfall(a) || a.sku.localeCompare(b.sku));
}

/**
 * One CSV cell. A value starting with = + - @ (or a tab / carriage return) gets a leading
 * apostrophe so a spreadsheet shows it as text instead of running it as a formula.
 */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Numbers stay plain (Latin digits, no grouping) so the spreadsheet reads them as numbers. */
function quantityCell(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The "below reorder point" list as CSV, largest shortfall first. No BOM; the caller adds it. */
export function reorderCsv(items: readonly ReorderItem[]): string {
  const rows = sortByShortfall(items).map((item) =>
    [
      csvCell(item.sku),
      csvCell(item.barcode),
      csvCell(item.name),
      quantityCell(item.quantity),
      quantityCell(item.minQuantity),
      quantityCell(shortfall(item)),
    ].join(","),
  );
  return ["sku,barcode,name,on_hand,min_quantity,shortfall", ...rows].join("\n");
}

/**
 * Parses a minimum quantity typed by the user (Persian digits allowed). Returns null unless it is
 * a number ≥ 0 with at most 2 decimals, which is what `UpdateStockItemDto.minQuantity` accepts.
 */
export function parseMinQuantity(input: string): number | null {
  const text = foldDigits(input.trim());
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}
