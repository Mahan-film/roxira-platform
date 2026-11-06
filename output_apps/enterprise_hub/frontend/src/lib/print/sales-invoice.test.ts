import assert from "node:assert/strict";
import { test } from "node:test";

import { SALES_INVOICE_A4_TEMPLATE } from "../../print-templates/sales-invoice-a4.template.ts";
import { Currency } from "../../types/currency.ts";
import {
  InvoiceDirection,
  InvoiceJurisdiction,
  InvoiceStatus,
  InvoiceSubject,
  type InvoiceResponseDto,
} from "../../types/invoicing.ts";
import { formatJalaliDate, formatNumber } from "../fa-format.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA4Data } from "./sales-invoice.ts";

const fixture = (overrides: Partial<InvoiceResponseDto> = {}): InvoiceResponseDto => ({
  id: "inv-1",
  taxInvoiceNumber: "1001",
  customerId: null,
  sellerInfo: { name: "شرکت نمونه آزمایشی" },
  buyerInfo: { name: "علی رضایی" },
  items: [
    {
      description: "کالای نمونه",
      quantity: 2,
      unitPrice: 500000,
      discount: 0,
      vatRate: 0.1,
      tax: 100000,
      total: 1100000,
    },
  ],
  currency: Currency.IRR,
  jurisdiction: InvoiceJurisdiction.IR,
  exchangeRate: 1,
  fxRate: 0,
  amountFx: null,
  baseCurrency: Currency.IRR,
  totalAmount: 1000000,
  totalDiscount: 0,
  totalTax: 100000,
  finalPayable: 1100000,
  baseTotalAmount: 1000000,
  baseTotalTax: 100000,
  baseFinalPayable: 1100000,
  status: InvoiceStatus.ISSUED,
  issuedAt: "2026-11-05T10:00:00Z",
  paidAt: null,
  createdAt: "2026-11-05T10:00:00Z",
  direction: InvoiceDirection.SALE,
  // "none": the enum has no Moadian type, so this invoice is not an e-invoice.
  einvoiceType: 0,
  subject: InvoiceSubject.ORIGINAL,
  relatedInvoiceId: null,
  warehouseId: null,
  ...overrides,
}) as unknown as InvoiceResponseDto;

const withSellerName = (name: string): InvoiceResponseDto => fixture({ sellerInfo: { name } });

test("maps the header, parties and status flags", () => {
  const data = mapInvoiceToSalesInvoiceA4Data(fixture(), "صادرشده");
  assert.equal(data.invoiceNumber, "1001");
  assert.equal(data.docTitle, "فاکتور فروش");
  assert.equal(data.isEinvoice, false);
  assert.equal(data.isDraft, false);
  assert.equal((data.seller as { name: string }).name, "شرکت نمونه آزمایشی");
  assert.equal((data.buyer as { name: string }).name, "علی رضایی");
  assert.equal((data.lines as Array<{ description: string }>)[0].description, "کالای نمونه");
});

test("renders the payable amount in words", () => {
  const data = mapInvoiceToSalesInvoiceA4Data(fixture(), "صادرشده");
  const words = (data.totals as { grandInWords: string }).grandInWords;
  assert.ok(words.includes("یک میلیون و صد هزار"));
});

test("escapes user text through the renderer", () => {
  const html = renderTemplate(
    SALES_INVOICE_A4_TEMPLATE,
    mapInvoiceToSalesInvoiceA4Data(withSellerName("<b>x</b>"), "پیش‌نویس"),
  );
  assert.equal(html.includes("<b>x</b>"), false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("formats line and total numbers with the shared formatter", () => {
  const data = mapInvoiceToSalesInvoiceA4Data(fixture(), "صادرشده");
  const line = (data.lines as Array<Record<string, string>>)[0];
  const totals = data.totals as Record<string, string>;
  // Allowed exception: expected values are computed with formatNumber rather than written by hand.
  assert.equal(line.quantity, formatNumber(2));
  assert.equal(line.unitPrice, formatNumber(500000));
  assert.equal(line.lineTotal, formatNumber(1100000));
  assert.equal(line.vatRate, formatNumber(0.1 * 100) + "٪");
  assert.equal(totals.beforeDiscount, formatNumber(1000000));
  assert.equal(totals.discount, formatNumber(0));
  assert.equal(totals.vat, formatNumber(100000));
  assert.equal(totals.grand, formatNumber(1100000));
});

test("shows the issue date in Jalali", () => {
  const data = mapInvoiceToSalesInvoiceA4Data(fixture(), "صادرشده");
  // 2026-11-05 is 1405/08/14 in the Jalali calendar.
  assert.equal(data.issueDateJalali, formatJalaliDate("2026-11-05"));
});
