import { BadRequestException } from '@nestjs/common';
import { multiplyMinorByDecimalQuantity } from './import-tie-out.engine';

export type StockLayerMode = 'BATCH' | 'AVERAGE';

export interface OpeningStockBatchInput {
  sku: string;
  name?: string;
  batchNumber?: string;
  quantity: string | number;
  unitCostMinor: bigint;
  receivedDate?: string;
}

export interface OpeningStockLayer {
  sku: string;
  batchNumber: string;
  quantity: string;
  unitCostMinor: bigint;
  totalValueMinor: bigint;
  mode: StockLayerMode;
  note?: string;
}

export interface OpeningStockBuildResult {
  mode: StockLayerMode;
  layers: OpeningStockLayer[];
  totalInventoryMinor: bigint;
  trialBalanceInventoryMinor: bigint;
  varianceMinor: bigint;
  balanced: boolean;
}

export interface OpenOrderImportInput {
  orderNo: string;
  kind: 'PO' | 'SO';
  partyCode: string;
  orderedQty: string | number;
  fulfilledQty: string | number;
  unitPriceMinor: bigint;
  depositMinor?: bigint;
}

export interface ImportedOpenOrder {
  orderNo: string;
  kind: 'PO' | 'SO';
  partyCode: string;
  orderedQty: string;
  fulfilledQty: string;
  remainingQty: string;
  fulfilledValueMinor: bigint;
  remainingValueMinor: bigint;
  depositMinor: bigint;
  netOpenMinor: bigint;
  status: 'OPEN' | 'PARTIAL' | 'FULFILLED';
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function parseDecimalToScaled(raw: string | number, label: string): { scaled: bigint; scale: number; text: string } {
  const text = String(raw).trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) {
    throw new BadRequestException(`مقدار ${label} نامعتبر است: «${text}»`);
  }
  const [, sign, intPart, fracPart = ''] = m;
  if (sign === '-') {
    throw new BadRequestException(`مقدار ${label} نمی‌تواند منفی باشد: «${text}»`);
  }
  const scaled = BigInt(`${intPart}${fracPart}`);
  return { scaled, scale: fracPart.length, text };
}

function formatScaled(scaled: bigint, scale: number): string {
  if (scale === 0) return scaled.toString();
  const str = scaled.toString().padStart(scale + 1, '0');
  const intPart = str.slice(0, str.length - scale);
  const fracPart = str.slice(str.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function addQuantities(a: string | number, b: string | number, label: string): string {
  const pa = parseDecimalToScaled(a, label);
  const pb = parseDecimalToScaled(b, label);
  const maxScale = Math.max(pa.scale, pb.scale);
  const sa = pa.scaled * 10n ** BigInt(maxScale - pa.scale);
  const sb = pb.scaled * 10n ** BigInt(maxScale - pb.scale);
  return formatScaled(sa + sb, maxScale);
}

function subtractQuantities(ordered: string | number, fulfilled: string | number): { remaining: string; isZero: boolean; isFull: boolean } {
  const po = parseDecimalToScaled(ordered, 'سفارش');
  const pf = parseDecimalToScaled(fulfilled, 'تحویل/ارسال');
  const maxScale = Math.max(po.scale, pf.scale);
  const so = po.scaled * 10n ** BigInt(maxScale - po.scale);
  const sf = pf.scaled * 10n ** BigInt(maxScale - pf.scale);
  if (sf > so) {
    throw new BadRequestException('مقدار تحویل یا ارسال نمی‌تواند از مقدار سفارش بیشتر باشد.');
  }
  const rem = so - sf;
  return {
    remaining: formatScaled(rem, maxScale),
    isZero: sf === 0n,
    isFull: rem === 0n,
  };
}

/**
 * ساخت لایه‌های موجودی افتتاحیه (یک لایه به‌ازای هر دسته یا یک لایه میانگین با یادداشت)
 * و تطبیق ارزش کل موجودی با تراز آزمایشی افتتاحیه (TB).
 */
export function buildOpeningStockLayers(options: {
  items: OpeningStockBatchInput[];
  mode: StockLayerMode;
  trialBalanceInventoryMinor: bigint;
  requireTbMatch?: boolean;
}): OpeningStockBuildResult {
  const layers: OpeningStockLayer[] = [];

  if (options.mode === 'BATCH') {
    for (const item of options.items) {
      const qtyInfo = parseDecimalToScaled(item.quantity, `موجودی (${item.sku})`);
      if (item.unitCostMinor < 0n) {
        throw new BadRequestException(`بهای واحد نمی‌تواند منفی باشد (${item.sku}).`);
      }
      const totalValueMinor = multiplyMinorByDecimalQuantity(item.unitCostMinor, qtyInfo.text, '0');
      layers.push({
        sku: item.sku,
        batchNumber: item.batchNumber?.trim() || 'OPENING-1',
        quantity: qtyInfo.text,
        unitCostMinor: item.unitCostMinor,
        totalValueMinor,
        mode: 'BATCH',
      });
    }
  } else {
    const bySku = new Map<string, OpeningStockBatchInput[]>();
    for (const item of options.items) {
      const list = bySku.get(item.sku) ?? [];
      list.push(item);
      bySku.set(item.sku, list);
    }
    for (const [sku, batches] of bySku.entries()) {
      let totalQty = '0';
      let totalValueMinor = 0n;
      for (const b of batches) {
        const qtyInfo = parseDecimalToScaled(b.quantity, `موجودی (${sku})`);
        if (b.unitCostMinor < 0n) {
          throw new BadRequestException(`بهای واحد نمی‌تواند منفی باشد (${sku}).`);
        }
        totalQty = addQuantities(totalQty, qtyInfo.text, `موجودی (${sku})`);
        totalValueMinor += multiplyMinorByDecimalQuantity(b.unitCostMinor, qtyInfo.text, '0');
      }
      const parsedTotal = parseDecimalToScaled(totalQty, `موجودی (${sku})`);
      const avgUnitCostMinor =
        parsedTotal.scaled === 0n
          ? 0n
          : (totalValueMinor * 10n ** BigInt(parsedTotal.scale)) / parsedTotal.scaled;
      layers.push({
        sku,
        batchNumber: 'OPENING-AVG',
        quantity: totalQty,
        unitCostMinor: avgUnitCostMinor,
        totalValueMinor,
        mode: 'AVERAGE',
        note: `لایه میانگین افتتاحیه از ${batches.length} دسته`,
      });
    }
  }

  const totalInventoryMinor = layers.reduce((sum, l) => sum + l.totalValueMinor, 0n);
  const varianceMinor = totalInventoryMinor - options.trialBalanceInventoryMinor;
  const balanced = varianceMinor === 0n;

  if (options.requireTbMatch && !balanced) {
    throw new BadRequestException(
      `ارزش موجودی افتتاحیه (${totalInventoryMinor}) با تراز آزمایشی (${options.trialBalanceInventoryMinor}) برابر نیست (اختلاف: ${varianceMinor}).`,
    );
  }

  return {
    mode: options.mode,
    layers,
    totalInventoryMinor,
    trialBalanceInventoryMinor: options.trialBalanceInventoryMinor,
    varianceMinor,
    balanced,
  };
}

/**
 * ورود سفارش‌های باز خرید (PO) و فروش (SO) در زمان راه‌اندازی:
 * - سفارش خرید نیمه‌تحویل‌شده بخش دریافت‌شده را حفظ و مانده باز را محاسبه می‌کند.
 * - سفارش فروش نیمه‌ارسال‌شده مانده تعهد و پیش‌دریافت مشتری را حفظ می‌کند.
 */
export function importOpenOrders(orders: OpenOrderImportInput[]): ImportedOpenOrder[] {
  return orders.map((order) => {
    if (order.unitPriceMinor < 0n) {
      throw new BadRequestException(`قیمت واحد سفارش ${order.orderNo} نمی‌تواند منفی باشد.`);
    }
    const depositMinor = order.depositMinor ?? 0n;
    if (depositMinor < 0n) {
      throw new BadRequestException(`پیش‌پرداخت/پیش‌دریافت سفارش ${order.orderNo} نمی‌تواند منفی باشد.`);
    }
    const { remaining, isZero, isFull } = subtractQuantities(order.orderedQty, order.fulfilledQty);
    const fulfilledText = String(order.fulfilledQty).trim();
    const fulfilledValueMinor = multiplyMinorByDecimalQuantity(order.unitPriceMinor, fulfilledText, '0');
    const remainingValueMinor = multiplyMinorByDecimalQuantity(order.unitPriceMinor, remaining, '0');
    const netOpenMinor = remainingValueMinor - depositMinor;

    return {
      orderNo: order.orderNo,
      kind: order.kind,
      partyCode: order.partyCode,
      orderedQty: String(order.orderedQty).trim(),
      fulfilledQty: fulfilledText,
      remainingQty: remaining,
      fulfilledValueMinor,
      remainingValueMinor,
      depositMinor,
      netOpenMinor,
      status: isFull ? 'FULFILLED' : isZero ? 'OPEN' : 'PARTIAL',
    };
  });
}
