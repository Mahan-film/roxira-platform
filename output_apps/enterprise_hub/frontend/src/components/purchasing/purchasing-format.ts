import { formatMoneyRial, formatNumber } from "../../lib/fa-format.ts";

/**
 * Format bigint minor units (rials x 100) using the shared money formatter.
 */
export function formatMinorMoney(minor?: string | number | bigint | null): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  try {
    return formatMoneyRial(BigInt(minor));
  } catch {
    return "—";
  }
}

/**
 * Format quantity in hundredths ("1000" = 10.00).
 */
export function formatQuantity(hundredths?: string | number | null): string {
  if (hundredths === null || hundredths === undefined || hundredths === "") return "—";
  const num = Number(hundredths) / 100;
  return Number.isFinite(num) ? formatNumber(num) : "—";
}

/**
 * Format weight in thousandths of kg ("500" = 0.500 kg).
 */
export function formatWeight(weightThousandths?: string | number | null): string {
  if (weightThousandths === null || weightThousandths === undefined || weightThousandths === "") return "—";
  const num = Number(weightThousandths) / 1000;
  return Number.isFinite(num) ? `${formatNumber(num)} کیلوگرم` : "—";
}
