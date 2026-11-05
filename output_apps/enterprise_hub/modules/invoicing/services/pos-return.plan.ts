import { BadRequestException } from '@nestjs/common';
import { minorToDecimal, toMinor } from '../../accounting/money';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceItemDto } from '../dto/create-invoice.dto';
import { InvoiceItem } from '../entities/invoice.entity';

/** Quantities carry at most three decimals: compare them as whole thousandths. */
const milli = (quantity: number): bigint => BigInt(Math.round(quantity * 1000));

/** Smallest amount of the currency in money minor units (whole rials for IRR, one rial for IRT). */
export function currencyUnit(currency: Currency): bigint {
  if (currency === Currency.IRR) {
    return 100n;
  }
  return currency === Currency.IRT ? 10n : 1n;
}

/** a / b rounded half up to a multiple of `unit` (all positive). */
function divToUnit(a: bigint, b: bigint, unit: bigint): bigint {
  const divisor = b * unit;
  return ((a * 2n + divisor) / (2n * divisor)) * unit;
}

const toNumber = (minor: bigint): number => Number(minorToDecimal(minor));

export interface ReturnLineRequest {
  originalLine: number;
  quantity: number;
}

/**
 * Lines of a return of `sold`, priced exactly as they were sold: same unit price and VAT rate,
 * and the line discount in proportion to the quantity returned. The return that empties a line
 * takes what is left of its discount, so several partial returns add up to the original line.
 * Earlier returns count against what is left; a line without `originalLine` (an older return
 * made through the plain invoice form) counts against the first line with its SKU.
 */
export function planReturnLines(
  sold: InvoiceItem[],
  earlierReturns: InvoiceItem[][],
  requested: ReturnLineRequest[],
  currency: Currency,
): InvoiceItemDto[] {
  const returnedQty = sold.map(() => 0n);
  const returnedDiscount = sold.map(() => 0n);
  for (const line of earlierReturns.flat()) {
    const index =
      line.originalLine ??
      sold.findIndex((s, i) => Boolean(s.sku) && s.sku === line.sku && returnedQty[i] < milli(s.quantity));
    if (index === undefined || index < 0 || index >= sold.length) {
      continue;
    }
    returnedQty[index] += milli(line.quantity);
    returnedDiscount[index] += toMinor(line.discount ?? 0);
  }

  const seen = new Set<number>();
  const unit = currencyUnit(currency);
  return requested.map(({ originalLine, quantity }) => {
    const line = sold[originalLine];
    if (!line || seen.has(originalLine)) {
      throw new BadRequestException(
        `سطر ${originalLine + 1} در فروش اصلی وجود ندارد یا تکراری آمده است.`,
      );
    }
    seen.add(originalLine);
    const soldQty = milli(line.quantity);
    const left = soldQty - returnedQty[originalLine];
    const wanted = milli(quantity);
    if (wanted <= 0n || wanted > left) {
      throw new BadRequestException(
        `تعداد برگشتی سطر ${originalLine + 1} (${quantity}) از باقی‌ماندهٔ قابل برگشت (${Number(left) / 1000}) بیشتر است.`,
      );
    }
    const discountMinor = toMinor(line.discount ?? 0);
    const discount =
      wanted === left
        ? discountMinor - returnedDiscount[originalLine]
        : divToUnit(discountMinor * wanted, soldQty, unit);
    return {
      ...(line.itemId ? { itemId: line.itemId } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      description: line.description,
      quantity,
      unitPrice: line.unitPrice,
      discount: toNumber(discount < 0n ? 0n : discount),
      vatRate: line.vatRate,
      originalLine,
    };
  });
}

/**
 * The refund split over the methods the sale was paid with, in proportion to what each method
 * took (in the sale's order); the last method absorbs the rounding. A sale with no recorded
 * payments is refunded in cash.
 */
export function splitRefund(
  total: number,
  payments: Array<{ method: string; amount: number }> | null | undefined,
  currency: Currency,
): Array<{ method: string; amount: number }> {
  const byMethod = new Map<string, bigint>();
  for (const payment of payments ?? []) {
    byMethod.set(payment.method, (byMethod.get(payment.method) ?? 0n) + toMinor(payment.amount));
  }
  const totalMinor = toMinor(total);
  const paid = [...byMethod.values()].reduce((sum, amount) => sum + amount, 0n);
  if (byMethod.size === 0 || paid <= 0n) {
    return [{ method: 'CASH', amount: total }];
  }
  const unit = currencyUnit(currency);
  const entries = [...byMethod.entries()];
  let assigned = 0n;
  return entries
    .map(([method, amount], index) => {
      const share =
        index === entries.length - 1
          ? totalMinor - assigned
          : divToUnit(totalMinor * amount, paid, unit);
      assigned += share;
      return { method, amount: toNumber(share) };
    })
    .filter((part) => part.amount > 0);
}
