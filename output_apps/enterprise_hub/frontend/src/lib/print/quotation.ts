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

function parseRialMinor(val: unknown): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(Math.trunc(val));
  if (typeof val === 'string') {
    const s = val.replace(/,/g, '').trim();
    if (!s) return 0n;
    if (s.includes('.')) {
      const [intPart] = s.split('.');
      return BigInt(intPart || '0');
    }
    return BigInt(s);
  }
  return 0n;
}

function formatBigIntRial(val: bigint): string {
  if (val >= -9007199254740991n && val <= 9007199254740991n) {
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
  const vatRate = typeof meta.vatRate === 'number' && meta.vatRate >= 0 ? meta.vatRate : 0.1;
  const vatRatePercent = Math.round(vatRate * 100);

  let totalDiscountBig = 0n;
  let linesTotalBig = 0n;

  for (const l of lines) {
    const qBig = BigInt(Math.max(1, Math.trunc(Number(l.quantity) || 1)));
    const pBig = parseRialMinor(l.unitPrice);
    const dBig = parseRialMinor(l.discount);
    totalDiscountBig += dBig;
    const lTotal = l.lineTotal ? parseRialMinor(l.lineTotal) : qBig * pBig - dBig;
    linesTotalBig += lTotal;
  }

  let totalAmountBig = parseRialMinor(quotation.totalAmount);
  if (totalAmountBig === 0n && linesTotalBig > 0n) {
    totalAmountBig = linesTotalBig;
  }

  const amountBeforeDiscountBig = totalAmountBig + totalDiscountBig;
  const totalVatBig = (totalAmountBig * BigInt(vatRatePercent)) / 100n;
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
    lines: lines.map((item, index) => {
      const q = Number(item.quantity) || 1;
      const qBig = BigInt(Math.max(1, Math.trunc(q)));
      const pBig = parseRialMinor(item.unitPrice);
      const dBig = parseRialMinor(item.discount);
      const subtotalBig = qBig * pBig - dBig;
      const itemVatBig = (subtotalBig * BigInt(vatRatePercent)) / 100n;
      const lineTotalBig = subtotalBig + itemVatBig;
      return {
        row: formatNumber(index + 1),
        itemId: item.itemId ? formatNumber(item.itemId) : '',
        description: item.description || `سطر ${index + 1}`,
        quantity: formatNumber(q),
        unit: 'عدد',
        unitPrice: formatBigIntRial(pBig),
        amountBeforeDiscount: formatBigIntRial(qBig * pBig),
        discount: formatBigIntRial(dBig),
        amountAfterDiscount: formatBigIntRial(subtotalBig),
        vatRate: `${formatNumber(vatRatePercent)}٪`,
        vatAmount: formatBigIntRial(itemVatBig),
        lineTotal: formatBigIntRial(lineTotalBig),
      };
    }),
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
