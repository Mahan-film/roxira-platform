import { formatJalaliDate, formatNumber } from '../fa-format.ts';
import { integerToPersianWords } from '../persian-words.ts';
import {
  QUOTATION_STATUS_LABELS,
  type SalesQuotationResponseDto,
} from '../../types/quotation.ts';

export interface QuotationPrintMeta {
  sellerName?: string;
  sellerNationalId?: string;
  sellerEconomicCode?: string;
  sellerAddress?: string;
  sellerPhone?: string;
  buyerName?: string;
  buyerNationalId?: string;
  buyerEconomicCode?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  vatRate?: number | string;
}

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const FIVE_THOUSAND = BigInt(5000);
const TEN_THOUSAND = BigInt(10000);
const DEFAULT_VAT_BPS = BigInt(1000);
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIG = -MAX_SAFE_BIG;

function parseVatRateBps(val?: number | string): bigint {
  if (val === undefined || val === null) return DEFAULT_VAT_BPS;
  const s = String(val).trim();
  if (!s) return DEFAULT_VAT_BPS;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) {
    throw new Error(`Invalid VAT rate: ${s}`);
  }
  const whole = BigInt(match[1]);
  const fracRaw = match[2] ?? '';
  const frac4 = BigInt(fracRaw.padEnd(4, '0').slice(0, 4));
  // Values > 1 are percentages (e.g. 9 -> 900 bps, 9.5 -> 950 bps); <= 1 are fractions (e.g. 0.09 -> 900 bps).
  if (whole > BigInt(1) || (whole === BigInt(1) && frac4 > ZERO)) {
    const frac2 = BigInt(fracRaw.padEnd(2, '0').slice(0, 2));
    return whole * HUNDRED + frac2;
  }
  return whole * TEN_THOUSAND + frac4;
}

function formatVatRatePercent(bps: bigint): string {
  const whole = bps / HUNDRED;
  const rem = bps % HUNDRED;
  if (rem === ZERO) {
    return `${formatNumber(Number(whole))}٪`;
  }
  const remStr = rem.toString().padStart(2, '0').replace(/0+$/, '');
  const remFa = remStr.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  return `${formatNumber(Number(whole))}.${remFa}٪`;
}

function parseRialMinor(val: unknown): bigint {
  if (val === null || val === undefined) return ZERO;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') {
    if (!Number.isSafeInteger(val)) {
      throw new Error(`Invalid Rial minor amount: ${String(val)}`);
    }
    return BigInt(val);
  }
  if (typeof val === 'string') {
    const s = val.replace(/,/g, '').trim();
    const match = /^(-?\d+)(?:\.0+)?$/.exec(s);
    if (!match) {
      throw new Error(`Invalid Rial minor amount: ${val}`);
    }
    return BigInt(match[1]);
  }
  throw new Error(`Unsupported Rial minor amount type: ${typeof val}`);
}

function formatBigIntRial(val: bigint): string {
  if (val >= MIN_SAFE_BIG && val <= MAX_SAFE_BIG) {
    return formatNumber(Number(val));
  }
  const str = val.toString();
  const negative = str.startsWith('-');
  const abs = negative ? str.slice(1) : str;
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  const persian = grouped.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  return negative ? `-${persian}` : persian;
}

/**
 * Maps a Sales Quotation (پیش‌فاکتور) to the T81 sales-invoice-a4 template data.
 */
export function mapQuotationToSalesInvoiceA4Data(
  quotation: SalesQuotationResponseDto,
  meta: QuotationPrintMeta = {},
): Record<string, unknown> {
  const lines = quotation.lines ?? [];
  const vatBps = parseVatRateBps(meta.vatRate);
  const vatRateLabel = formatVatRatePercent(vatBps);

  let totalDiscountBig = ZERO;
  let linesTotalBig = ZERO;
  let totalLineVatBig = ZERO;

  const mappedLines = lines.map((item, index) => {
    const qNum = Number(item.quantity);
    const qVal = Number.isFinite(qNum) && qNum >= 0 ? qNum : 0;
    const qBig = BigInt(Math.trunc(qVal));
    const pBig = parseRialMinor(item.unitPrice);
    const dBig = parseRialMinor(item.discount);
    totalDiscountBig += dBig;
    const subtotalBig = qBig * pBig - dBig;
    linesTotalBig += subtotalBig;
    const itemVatBig = (subtotalBig * vatBps + FIVE_THOUSAND) / TEN_THOUSAND;
    totalLineVatBig += itemVatBig;
    const lineTotalBig = subtotalBig + itemVatBig;
    return {
      row: formatNumber(index + 1),
      itemId: item.itemId ? formatNumber(item.itemId) : '',
      description: item.description || `سطر ${index + 1}`,
      quantity: formatNumber(qVal),
      unit: 'عدد',
      unitPrice: formatBigIntRial(pBig),
      amountBeforeDiscount: formatBigIntRial(qBig * pBig),
      discount: formatBigIntRial(dBig),
      amountAfterDiscount: formatBigIntRial(subtotalBig),
      vatRate: vatRateLabel,
      vatAmount: formatBigIntRial(itemVatBig),
      lineTotal: formatBigIntRial(lineTotalBig),
    };
  });

  let totalAmountBig = parseRialMinor(quotation.totalAmount);
  if (totalAmountBig === ZERO && linesTotalBig > ZERO) {
    totalAmountBig = linesTotalBig;
  }

  const amountBeforeDiscountBig = totalAmountBig + totalDiscountBig;
  const totalVatBig =
    mappedLines.length > 0 ? totalLineVatBig : (totalAmountBig * vatBps + FIVE_THOUSAND) / TEN_THOUSAND;
  const grandTotalBig = totalAmountBig + totalVatBig;

  const validUntilNote = quotation.validUntil
    ? `مهلت اعتبار پیش‌فاکتور: تا تاریخ ${formatJalaliDate(quotation.validUntil)}`
    : '';
  const fullNotes = [validUntilNote, quotation.note].filter(Boolean).join(' — ');

  return {
    docTitle: 'پیش‌فاکتور فروش',
    invoiceNumber: quotation.number,
    issueDateJalali: formatJalaliDate(quotation.quoteDate),
    issueTime: '',
    statusLabel: QUOTATION_STATUS_LABELS[quotation.status] ?? quotation.status,
    isDraft: quotation.status === 'DRAFT',
    isEinvoice: false,
    einvoiceType: '',
    taxId: '',
    trackingCode: '',
    sendStatusText: '',
    pattern: '',
    relatedTaxId: '',
    qrSvg: '',
    showQr: false,
    logoUrl: '',
    footerText: 'این برگه پیش‌فاکتور بوده و فاقد جنبه قانونی یا مالیاتی به عنوان فاکتور قطعی است.',
    notes: fullNotes,
    settlementMethod: '',
    cashAmount: '',
    creditAmount: '',
    seller: {
      name: meta.sellerName || 'سازمان من',
      economicCode: meta.sellerEconomicCode || '',
      nationalId: meta.sellerNationalId || '',
      registrationNumber: '',
      postalCode: '',
      address: meta.sellerAddress || '',
      phone: meta.sellerPhone || '',
      branchCode: '',
    },
    buyer: {
      name: meta.buyerName || `مشتری (${quotation.partyCode})`,
      economicCode: meta.buyerEconomicCode || '',
      nationalId: meta.buyerNationalId || '',
      registrationNumber: '',
      postalCode: '',
      address: meta.buyerAddress || '',
      phone: meta.buyerPhone || '',
    },
    extraHeaderFacts: '',
    lines: mappedLines,
    totals: {
      beforeDiscount: formatBigIntRial(amountBeforeDiscountBig),
      discount: formatBigIntRial(totalDiscountBig),
      afterDiscount: formatBigIntRial(totalAmountBig),
      vat: formatBigIntRial(totalVatBig),
      otherTaxes: '',
      grand: formatBigIntRial(grandTotalBig),
      grandInWords: `${integerToPersianWords(grandTotalBig)} ریال`,
    },
    currencyLabel: 'ریال',
    isForeign: false,
    foreignTotalText: '',
    rialEquivalentText: '',
  };
}
