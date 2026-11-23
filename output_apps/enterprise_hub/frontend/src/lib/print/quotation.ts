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
  vatRate?: number;
}

const ZERO = BigInt(0);
const FIFTY = BigInt(50);
const HUNDRED = BigInt(100);
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIG = -MAX_SAFE_BIG;

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
  const rawRate = typeof meta.vatRate === 'number' && meta.vatRate >= 0 ? meta.vatRate : 0.1;
  const vatRate = rawRate > 1 ? rawRate / 100 : rawRate;
  const vatRatePercent = Math.round(vatRate * 100);

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
    const itemVatBig = (subtotalBig * BigInt(vatRatePercent) + FIFTY) / HUNDRED;
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
      vatRate: `${formatNumber(vatRatePercent)}٪`,
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
    mappedLines.length > 0 ? totalLineVatBig : (totalAmountBig * BigInt(vatRatePercent) + FIFTY) / HUNDRED;
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
