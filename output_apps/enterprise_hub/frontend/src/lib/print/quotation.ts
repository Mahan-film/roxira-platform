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
}

/**
 * Maps a Sales Quotation (پیش‌فاکتور) to the T81 sales-invoice-a4 template data.
 */
export function mapQuotationToSalesInvoiceA4Data(
  quotation: SalesQuotationResponseDto,
  meta: QuotationPrintMeta = {},
): Record<string, unknown> {
  const lines = quotation.lines ?? [];
  const linesTotal = lines.reduce(
    (acc, l) => acc + (Number(l.lineTotal) || Number(l.quantity) * Number(l.unitPrice) - Number(l.discount || 0)),
    0,
  );
  const totalAmount = Number(quotation.totalAmount) || linesTotal;
  const totalDiscount = lines.reduce((acc, l) => acc + (Number(l.discount) || 0), 0);
  const amountBeforeDiscount = totalAmount + totalDiscount;
  // Quotations standard estimated VAT (10%)
  const vatRate = 0.1;
  const totalVat = Math.round(totalAmount * vatRate);
  const grandTotal = totalAmount + totalVat;

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
      const p = Number(item.unitPrice) || 0;
      const d = Number(item.discount) || 0;
      const subtotal = q * p - d;
      const itemVat = Math.round(subtotal * vatRate);
      return {
        row: formatNumber(index + 1),
        itemId: item.itemId ? formatNumber(item.itemId) : '',
        description: item.description || `سطر ${index + 1}`,
        quantity: formatNumber(q),
        unit: 'عدد',
        unitPrice: formatNumber(p),
        amountBeforeDiscount: formatNumber(q * p),
        discount: formatNumber(d),
        amountAfterDiscount: formatNumber(subtotal),
        vatRate: '۱۰٪',
        vatAmount: formatNumber(itemVat),
        lineTotal: formatNumber(subtotal + itemVat),
      };
    }),
    totals: {
      beforeDiscount: formatNumber(amountBeforeDiscount),
      discount: formatNumber(totalDiscount),
      afterDiscount: formatNumber(totalAmount),
      vat: formatNumber(totalVat),
      otherTaxes: '',
      grand: formatNumber(grandTotal),
      grandInWords: `${integerToPersianWords(BigInt(Math.round(grandTotal)))} ریال`,
    },
    currencyLabel: 'ریال',
    isForeign: false,
    foreignTotalText: '',
    rialEquivalentText: '',
  };
}
