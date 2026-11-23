import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SALES_INVOICE_A4_TEMPLATE } from '../../print-templates/sales-invoice-a4.template.ts';
import type { SalesQuotationResponseDto } from '../../types/quotation.ts';
import { formatJalaliDate } from '../fa-format.ts';
import { renderTemplate } from './render-template.ts';
import { mapQuotationToSalesInvoiceA4Data } from './quotation.ts';

const fixture = (overrides: Partial<SalesQuotationResponseDto> = {}): SalesQuotationResponseDto => ({
  id: 1,
  number: 'QT-1405-001',
  partyCode: 'CUST-001',
  quoteDate: '2026-11-10',
  validUntil: '2026-12-10',
  status: 'SENT',
  note: 'پیش‌فاکتور رسمی ۳۰ روزه',
  totalAmount: 1000000,
  createdBy: 'user-1',
  createdAt: '2026-11-10T08:00:00Z',
  updatedAt: '2026-11-10T08:00:00Z',
  lines: [
    {
      id: 10,
      lineNo: 1,
      itemId: 42,
      description: 'سرور اختصاصی ابری',
      quantity: 2,
      unitPrice: 500000,
      discount: 0,
      lineTotal: 1000000,
    },
  ],
  ...overrides,
});

test('maps quotation to T81 sales-invoice-a4 template with proforma docTitle', () => {
  const data = mapQuotationToSalesInvoiceA4Data(fixture(), {
    sellerName: 'شرکت فناوران کسری',
    buyerName: 'شرکت پیشرو صنعت',
  });

  assert.equal(data.docTitle, 'پیش‌فاکتور فروش');
  assert.equal(data.invoiceNumber, 'QT-1405-001');
  assert.equal(data.statusLabel, 'ارسال‌شده');
  assert.equal(data.isDraft, false);
  assert.equal((data.seller as { name: string }).name, 'شرکت فناوران کسری');
  assert.equal((data.buyer as { name: string }).name, 'شرکت پیشرو صنعت');
  assert.equal((data.lines as Array<{ description: string }>)[0].description, 'سرور اختصاصی ابری');
});

test('renders quotation grand total with VAT in Persian words', () => {
  const data = mapQuotationToSalesInvoiceA4Data(fixture());
  const words = (data.totals as { grandInWords: string }).grandInWords;
  assert.ok(words.includes('یک میلیون و صد هزار'));
  assert.ok(words.includes('ریال'));
});

test('escapes user notes and text when rendered into T81 HTML template', () => {
  const html = renderTemplate(
    SALES_INVOICE_A4_TEMPLATE,
    mapQuotationToSalesInvoiceA4Data(fixture({ note: '<script>alert(1)</script>' })),
  );

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('includes validity expiry date in notes', () => {
  const data = mapQuotationToSalesInvoiceA4Data(fixture());
  const notes = data.notes as string;
  assert.ok(notes.includes('مهلت اعتبار'));
  assert.ok(notes.includes(formatJalaliDate('2026-12-10')));
});

test('handles large Rial amounts with exact BigInt without float precision loss', () => {
  const hugeAmount = '90071992547409930'; // exceeds 2^53
  const data = mapQuotationToSalesInvoiceA4Data(
    fixture({
      totalAmount: hugeAmount,
      lines: [
        {
          lineNo: 1,
          itemId: 10,
          description: 'کالای سنگین',
          quantity: 1,
          unitPrice: hugeAmount,
          discount: '0',
          lineTotal: hugeAmount,
        },
      ],
    }),
    { vatRate: 0.1 },
  );
  const totals = data.totals as Record<string, string>;
  assert.ok(totals.afterDiscount.includes('۹۰'));
  assert.ok(totals.grandInWords.includes('ریال'));
});

test('ensures sum of line VATs exactly matches document total VAT and supports zero quantity', () => {
  const data = mapQuotationToSalesInvoiceA4Data(
    fixture({
      lines: [
        { lineNo: 1, itemId: 1, description: 'Line 1', quantity: 1, unitPrice: 15, discount: 0, lineTotal: 15 },
        { lineNo: 2, itemId: 2, description: 'Line 2', quantity: 1, unitPrice: 25, discount: 0, lineTotal: 25 },
        { lineNo: 3, itemId: 3, description: 'Free service', quantity: 0, unitPrice: 100, discount: 0, lineTotal: 0 },
      ],
      totalAmount: 40,
    }),
    { vatRate: 0.1 },
  );

  const lines = data.lines as Array<{ vatAmount: string; quantity: string }>;
  assert.equal(lines[2].quantity, '۰');
  const totals = data.totals as Record<string, string>;
  assert.ok(totals.vat);
});
