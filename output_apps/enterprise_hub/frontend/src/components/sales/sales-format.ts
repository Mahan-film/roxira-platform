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

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function parsePositiveInt(raw: string): number | null {
  const s = toAsciiDigits(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const bi = BigInt(s);
  if (bi <= BigInt(0) || bi > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(s);
}

export function parseNonNegativeMinor(raw: string, emptyAsZero = false): string | null {
  const s = toAsciiDigits(raw).trim();
  if (s === "") return emptyAsZero ? "0" : null;
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s).toString();
}

const QTY_SCALE = BigInt(10000);

function decimalToScaledBigInt(raw: string): bigint | null {
  const s = toAsciiDigits(raw).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paddedFrac = (frac + "0000").slice(0, 4);
  return BigInt(whole) * QTY_SCALE + BigInt(paddedFrac);
}

export function parsePositiveDecimalString(raw: string): string | null {
  const scaled = decimalToScaledBigInt(raw);
  if (scaled === null || scaled <= BigInt(0)) return null;
  return toAsciiDigits(raw).trim();
}

export function computeLineTotalMinor(
  qtyStr: string,
  unitPriceStr: string,
  discountStr: string,
): string {
  const qtyScaled = decimalToScaledBigInt(qtyStr);
  const price = parseNonNegativeMinor(unitPriceStr, true);
  const discount = parseNonNegativeMinor(discountStr, true);
  if (qtyScaled === null || price === null || discount === null) return "0";
  const gross = (qtyScaled * BigInt(price)) / QTY_SCALE;
  const net = gross - BigInt(discount);
  return (net > BigInt(0) ? net : BigInt(0)).toString();
}

export function subtractPositiveDecimals(a: string | number, b: string | number): string {
  const sa = decimalToScaledBigInt(String(a)) ?? BigInt(0);
  const sb = decimalToScaledBigInt(String(b)) ?? BigInt(0);
  const diff = sa - sb;
  if (diff <= BigInt(0)) return "0";
  const whole = diff / QTY_SCALE;
  const frac = diff % QTY_SCALE;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(4, "0").replace(/0+$/, "")}`;
}
