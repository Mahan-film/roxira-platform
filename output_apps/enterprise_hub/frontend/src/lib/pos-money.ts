import type { PaymentMethod } from "../types/invoicing.ts";

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_HUNDRED = BigInt(100);
const BIGINT_MILLION = BigInt(1_000_000);

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

export function toFaDigits(raw: string | number): string {
  return String(raw).replace(/\d/g, (d) => FA_DIGITS[Number.parseInt(d, 10)] ?? d);
}

const DIGIT_MAP: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normaliseNumericInput(raw: string | number): string {
  const s = typeof raw === "number" ? String(raw) : raw;
  return s
    .trim()
    .replace(/,/g, "")
    .replace(/[۰-۹٠-٩]/g, (ch) => DIGIT_MAP[ch] ?? ch);
}

/**
 * Parses a non-negative decimal string/number into a scaled BigInt (`value * 10^scale`)
 * without floating-point rounding drift. Returns null for invalid or too-granular input.
 */
export function parseScaledNonNegativeInt(raw: string | number, scale = 2): bigint | null {
  const normalized = normaliseNumericInput(raw);
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const [intPart, fracPart = ""] = normalized.split(".");
  if (fracPart.length > scale) {
    return null;
  }
  const paddedFrac = fracPart.padEnd(scale, "0");
  return BigInt(intPart + paddedFrac);
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BIGINT_ZERO) {
    throw new RangeError("Denominator must be positive");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * BIGINT_TWO >= denominator ? quotient + BIGINT_ONE : quotient;
}

export interface PosMoneyLineInput {
  quantity: string | number;
  unitPrice: string | number;
}

export interface PosCartTotals {
  /** Net total in whole Rials (bigint) */
  netTotal: bigint;
  /** VAT total in whole Rials (bigint) */
  vatTotal: bigint;
  /** Payable total in whole Rials (bigint) */
  payableTotal: bigint;
}

/**
 * Computes exact whole-Rial net total, VAT total, and final payable using BigInt
 * arithmetic (no floating-point math). Quantities support up to 2 decimal places;
 * VAT rate supports up to 4 decimal places (percent).
 */
export function computePosCartTotals(
  lines: PosMoneyLineInput[],
  vatRatePercent: string | number,
): PosCartTotals {
  // rateBpsScale = percent * 10^4, so divided by 10^6 gives fraction
  const vatRateScaled = parseScaledNonNegativeInt(vatRatePercent, 4) ?? BIGINT_ZERO;

  let netTotal = BIGINT_ZERO;
  for (const line of lines) {
    const qtyScaled = parseScaledNonNegativeInt(line.quantity, 2);
    const unitPriceRial = parseScaledNonNegativeInt(line.unitPrice, 0);
    if (
      qtyScaled === null ||
      unitPriceRial === null ||
      qtyScaled <= BIGINT_ZERO ||
      unitPriceRial <= BIGINT_ZERO
    ) {
      continue;
    }
    const lineNet = divideHalfUp(qtyScaled * unitPriceRial, BIGINT_HUNDRED);
    netTotal += lineNet;
  }

  const vatTotal = divideHalfUp(netTotal * vatRateScaled, BIGINT_MILLION);
  return {
    netTotal,
    vatTotal,
    payableTotal: netTotal + vatTotal,
  };
}

/**
 * Splits payable whole-Rial total into CARD + primary method payments without floats.
 * Returns null if cardAmountRaw is negative, non-integer, or exceeds payableTotal.
 */
export function splitPosPayment(
  payableTotal: bigint,
  cardAmountRaw: string,
  primaryMethod: PaymentMethod,
): Array<{ method: PaymentMethod; amount: number }> | null {
  const trimmed = normaliseNumericInput(cardAmountRaw);
  let cardAmount = BIGINT_ZERO;
  if (trimmed !== "") {
    const parsed = parseScaledNonNegativeInt(trimmed, 0);
    if (parsed === null) {
      return null;
    }
    cardAmount = parsed;
  }

  if (cardAmount < BIGINT_ZERO || cardAmount > payableTotal) {
    return null;
  }

  const payableNum = bigintToSafeJsonNumber(payableTotal);
  const cardNum = bigintToSafeJsonNumber(cardAmount);
  const remainderNum = bigintToSafeJsonNumber(payableTotal - cardAmount);

  if (cardAmount > BIGINT_ZERO && cardAmount < payableTotal) {
    return [
      { method: "CARD", amount: cardNum },
      { method: primaryMethod, amount: remainderNum },
    ];
  }
  return [{ method: cardAmount > BIGINT_ZERO ? "CARD" : primaryMethod, amount: payableNum }];
}

export function bigintToSafeJsonNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Amount exceeds JS safe integer bounds");
  }
  // Safe exact conversion validated within IEEE-754 integer range for JSON DTO serialization
  return Number.parseInt(value.toString(10), 10);
}

export function parsePosQuantity(raw: string): number | null {
  const scaled = parseScaledNonNegativeInt(raw, 2);
  if (scaled === null || scaled <= BIGINT_ZERO) return null;
  const whole = scaled / BIGINT_HUNDRED;
  const frac = Number.parseInt((scaled % BIGINT_HUNDRED).toString(10), 10);
  const wholeNum = bigintToSafeJsonNumber(whole);
  return wholeNum + frac / 100;
}

export function parsePosUnitPrice(raw: string): number | null {
  const whole = parseScaledNonNegativeInt(raw, 0);
  if (whole === null || whole <= BIGINT_ZERO) return null;
  return bigintToSafeJsonNumber(whole);
}
