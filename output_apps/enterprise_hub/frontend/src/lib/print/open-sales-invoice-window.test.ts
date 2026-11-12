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
import type { PrintTemplateDto } from "../../types/print-template.ts";
import { formatNumber } from "../fa-format.ts";

import { buildDynamicTableHtml, buildSalesInvoiceHtml } from "./open-sales-invoice-window.ts";
import { renderTemplate } from "./render-template.ts";
import { loadSalesInvoiceTemplates } from "./sales-invoice-templates.ts";
import { mapInvoiceToSalesInvoiceA4Data } from "./sales-invoice.ts";

const invoice = {
  id: "inv-1",
  taxInvoiceNumber: "1001",
  customerId: null,
  sellerInfo: { name: "شرکت نمونه" },
  buyerInfo: { name: "علی رضایی" },
  items: [
    { description: "کالا", quantity: 2, unitPrice: 500000, discount: 0, vatRate: 0.1, tax: 100000, total: 1100000 },
  ],
  currency: Currency.IRR,
  jurisdiction: InvoiceJurisdiction.IR,
  exchangeRate: 1,
  fxRate: 0,
  amountFx: null,
  baseCurrency: Currency.IRR,
  direction: InvoiceDirection.SALE,
  subject: InvoiceSubject.ORIGINAL,
  status: InvoiceStatus.ISSUED,
  totalAmount: 1000000,
  totalDiscount: 0,
  totalTax: 100000,
  finalPayable: 1100000,
  createdAt: "2026-01-01T00:00:00Z",
} as unknown as InvoiceResponseDto;

const tpl = (paperSize: string): Partial<PrintTemplateDto> =>
  ({
    paperSize,
    showLogo: false,
    options: { headerTitle: "عنوان سفارشی" },
    columnsConfig: [
      { key: "description", label: "شرح", visible: true, order: 1 },
      { key: "vat", label: "مالیات و عوارض", visible: true, order: 2 },
    ],
  }) as unknown as Partial<PrintTemplateDto>;

test("no saved template prints the original layout unchanged", () => {
  const original = renderTemplate(SALES_INVOICE_A4_TEMPLATE, mapInvoiceToSalesInvoiceA4Data(invoice, "صادر شده"));
  assert.equal(buildSalesInvoiceHtml(invoice, "صادر شده", null), original);
  assert.equal(buildSalesInvoiceHtml(invoice, "صادر شده", undefined), original);
});

test("the tax column prints the line tax amount, not the rate", () => {
  const html = buildDynamicTableHtml(invoice, tpl("A4").columnsConfig as never);
  assert.ok(html.includes(formatNumber(100000)));
  assert.ok(!html.includes("٪"));
  assert.ok(html.includes(`<td class="n">${formatNumber(invoice.totalTax)}</td>`)); // footer total matches the invoice
});

test("an A5 template renders the A5 layout, A4 the A4 layout", () => {
  const a5 = buildSalesInvoiceHtml(invoice, "صادر شده", tpl("A5"));
  const a4 = buildSalesInvoiceHtml(invoice, "صادر شده", tpl("A4"));
  assert.ok(a5.includes("عنوان سفارشی"));
  assert.notEqual(a5, a4);
  assert.ok(!a4.includes("80mm"));
  assert.ok(buildSalesInvoiceHtml(invoice, "صادر شده", tpl("THERMAL_80MM")).includes("80mm"));
});

test("templates are requested for A4, A5 and thermal", async () => {
  const asked: string[] = [];
  const out = await loadSalesInvoiceTemplates(async (size) => {
    asked.push(size);
    return null;
  });
  assert.deepEqual(asked.sort(), ["A4", "A5", "THERMAL_80MM"]);
  assert.deepEqual(out, { a4: null, a5: null, thermal: null });
});
