/**
 * Barcode scanning on the sales invoice and the POS drawer. A scanner types the code and presses
 * Enter; the matching item becomes a line. Pure helpers, shared by both forms and unit-tested.
 */

export interface ScannableItem {
  sku: string;
  barcode: string;
  name: string;
}

/** Persian and Arabic digits to Latin, surrounding spaces removed (scanners and keyboards differ). */
export function normaliseScan(code: string): string {
  return code
    .trim()
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** The item whose code or barcode is exactly `code`. The code wins over another item's barcode. */
export function findExact<T extends ScannableItem>(items: T[], code: string): T | null {
  return items.find((item) => item.sku === code) ?? items.find((item) => item.barcode === code) ?? null;
}

export function unknownBarcodeMessage(code: string): string {
  return `کالایی با کد یا بارکد «${code}» پیدا نشد. کد را بررسی کنید یا کالا را در انبار تعریف کنید.`;
}

export interface ScanLineOps<L> {
  /** The line's item code, or "" when the line has none. */
  codeOf: (line: L) => string;
  /** A line nobody has typed into yet (it is reused instead of adding a new one). */
  isBlank: (line: L) => boolean;
  /** The same line with one more unit. */
  addOne: (line: L) => L;
  /** A new line for the item (quantity 1). */
  fromItem: (item: ScannableItem) => L;
}

/**
 * Lines after scanning `item`: one more unit on the line that already has this item, otherwise
 * the first blank line becomes the item, otherwise a new line is appended.
 */
export function addScannedItem<L>(lines: L[], item: ScannableItem, ops: ScanLineOps<L>): L[] {
  const same = lines.findIndex((line) => ops.codeOf(line) === item.sku);
  if (same >= 0) {
    return lines.map((line, i) => (i === same ? ops.addOne(line) : line));
  }
  const blank = lines.findIndex((line) => ops.isBlank(line));
  if (blank >= 0) {
    return lines.map((line, i) => (i === blank ? ops.fromItem(item) : line));
  }
  return [...lines, ops.fromItem(item)];
}

/**
 * A sales-invoice editor row nobody has typed into: no item, code, description or price.
 * Quantity, discount and VAT have defaults, so they do not count.
 */
export function isUntypedInvoiceLine(line: {
  itemId: string;
  sku: string;
  description: string;
  unitPrice: string;
}): boolean {
  return !line.itemId && !line.sku && !line.description.trim() && !line.unitPrice.trim();
}

/** "2" -> "3". A quantity that is not a plain number restarts at "1". */
export function incrementQuantity(quantity: string): string {
  const value = Number(normaliseScan(quantity));
  return Number.isFinite(value) && value >= 0 ? String(value + 1) : "1";
}
