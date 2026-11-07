import assert from "node:assert/strict";
import { test } from "node:test";

import { SALES_INVOICE_A5_TEMPLATE } from "../../print-templates/sales-invoice-a5.template.ts";
import { Currency } from "../../types/currency.ts";
import {
  InvoiceDirection,
  InvoiceJurisdiction,
  InvoiceStatus,
  InvoiceSubject,
  type InvoiceResponseDto,
} from "../../types/invoicing.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA5Data } from "./sales-invoice-a5.ts";

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

test("maps the header, parties and the empty fields", () => {
  const data = mapInvoiceToSalesInvoiceA5Data(fixture(), "صادرشده");
  assert.equal(data.invoiceNumber, "1001");
  assert.equal(data.docTitle, "فاکتور فروش");
  assert.equal(data.isDraft, false);
  assert.equal(data.isEinvoice, false);
  assert.equal((data.seller as { name: string }).name, "شرکت نمونه آزمایشی");
  assert.equal((data.buyer as { name: string }).name, "علی رضایی");
  assert.equal((data.buyer as { postalCode: string }).postalCode, "");
  assert.equal(data.settlementMethod, "");
  assert.equal((data.lines as Array<Record<string, string>>)[0].unit, "");
  assert.equal((data.lines as Array<Record<string, string>>)[0].vatAmount, "");
});

test("marks only the DRAFT status as a draft", () => {
  assert.equal(
    mapInvoiceToSalesInvoiceA5Data(fixture({ status: InvoiceStatus.DRAFT }), "پیش‌نویس").isDraft,
    true,
  );
  assert.equal(mapInvoiceToSalesInvoiceA5Data(fixture(), "صادرشده").isDraft, false);
  assert.equal(
    mapInvoiceToSalesInvoiceA5Data(fixture({ status: InvoiceStatus.PAID }), "پرداخت‌شده").isDraft,
    false,
  );
  assert.equal(
    mapInvoiceToSalesInvoiceA5Data(fixture({ status: InvoiceStatus.CANCELLED }), "ابطال‌شده").isDraft,
    false,
  );
  const draftHtml = renderTemplate(
    SALES_INVOICE_A5_TEMPLATE,
    mapInvoiceToSalesInvoiceA5Data(fixture({ status: InvoiceStatus.DRAFT }), "پیش‌نویس"),
  );
  assert.ok(draftHtml.includes('<body class="is-draft">'));
  const issuedHtml = renderTemplate(
    SALES_INVOICE_A5_TEMPLATE,
    mapInvoiceToSalesInvoiceA5Data(fixture(), "صادرشده"),
  );
  assert.ok(issuedHtml.includes('<body class="">'));
});

test("formats the fixture amounts with Persian digits", () => {
  const data = mapInvoiceToSalesInvoiceA5Data(fixture(), "صادرشده");
  const line = (data.lines as Array<Record<string, string>>)[0];
  const totals = data.totals as Record<string, string>;
  assert.equal(line.row, "۱");
  assert.equal(line.quantity, "۲");
  assert.equal(line.unitPrice, "۵۰۰٬۰۰۰");
  assert.equal(line.discount, "۰");
  assert.equal(line.lineTotal, "۱٬۱۰۰٬۰۰۰");
  assert.equal(totals.discount, "۰");
  assert.equal(totals.vat, "۱۰۰٬۰۰۰");
  assert.equal(totals.grand, "۱٬۱۰۰٬۰۰۰");
  assert.ok(totals.grandInWords.includes("یک میلیون و صد هزار"));
});

test("renders the invoice number and grand total as the renderer produces them", () => {
  const html = renderTemplate(
    SALES_INVOICE_A5_TEMPLATE,
    mapInvoiceToSalesInvoiceA5Data(fixture(), "صادرشده"),
  );
  assert.ok(html.includes('<dd class="num">1001</dd>'));
  assert.ok(html.includes("۱٬۱۰۰٬۰۰۰"));
});

test("escapes user text through the renderer", () => {
  const html = renderTemplate(
    SALES_INVOICE_A5_TEMPLATE,
    mapInvoiceToSalesInvoiceA5Data(fixture({ sellerInfo: { name: "<b>x</b>" } }), "صادرشده"),
  );
  assert.equal(html.includes("<b>x</b>"), false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});
