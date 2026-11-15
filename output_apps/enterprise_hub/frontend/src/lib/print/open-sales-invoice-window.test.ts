import assert from "node:assert/strict";
import { test } from "node:test";

import { SALES_INVOICE_A4_TEMPLATE } from "../../print-templates/sales-invoice-a4.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";
import type { PrintTemplateDto } from "../../types/print-template.ts";
import { formatNumber } from "../fa-format.ts";

import { buildDynamicTableHtml, buildSalesInvoiceHtml, injectStyleTag, replaceTableById } from "./open-sales-invoice-window.ts";
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
  currency: "IRR" as never,
  jurisdiction: "IR" as never,
  exchangeRate: 1,
  fxRate: 0,
  amountFx: null,
  baseCurrency: "IRR" as never,
  direction: "SALE" as never,
  subject: "ORIGINAL" as never,
  status: "ISSUED" as never,
  totalAmount: 1000000,
  totalDiscount: 0,
  totalTax: 100000,
  finalPayable: 1100000,
  createdAt: "2026-01-01T00:00:00Z",
} as unknown as InvoiceResponseDto;

const tpl = (paperSize: string, extraOptions: Record<string, unknown> = {}): Partial<PrintTemplateDto> =>
  ({
    paperSize,
    showLogo: Boolean(extraOptions.showLogo),
    logoUrl: extraOptions.logoUrl as string | undefined,
    options: {
      headerTitle: "عنوان سفارشی",
      footerNote: extraOptions.footerNote as string | undefined,
    },
    columnsConfig: [
      { key: "description", label: "شرح کالا و خدمات سفارشی", visible: true, order: 1, widthPercent: 50 },
      { key: "vat", label: "مالیات و عوارض", visible: true, order: 2, widthPercent: 25 },
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

test("an A5 template renders the A5 layout with custom columns, logo, and footer", () => {
  const a5 = buildSalesInvoiceHtml(
    invoice,
    "صادر شده",
    tpl("A5", {
      showLogo: true,
      logoUrl: "https://example.com/logo.png",
      footerNote: "پانویس تستی فاکتور A5",
    }),
  );
  assert.ok(a5.includes("عنوان سفارشی"));
  assert.ok(a5.includes("https://example.com/logo.png"));
  assert.ok(a5.includes("پانویس تستی فاکتور A5"));
  // Custom columns table replacement lands on the items table
  assert.ok(a5.includes('<table id="invoice-items-table">'));
  assert.ok(a5.includes('شرح کالا و خدمات سفارشی'));
});

test("an A4 template renders the A4 layout with custom columns, logo, and footer", () => {
  const a4 = buildSalesInvoiceHtml(
    invoice,
    "صادر شده",
    tpl("A4", {
      showLogo: true,
      logoUrl: "https://example.com/logo.png",
      footerNote: "پانویس تستی فاکتور A4",
    }),
  );
  assert.ok(a4.includes("عنوان سفارشی"));
  assert.ok(a4.includes("https://example.com/logo.png"));
  assert.ok(a4.includes("پانویس تستی فاکتور A4"));
  assert.ok(a4.includes('<table id="invoice-items-table">'));
  assert.ok(a4.includes('شرح کالا و خدمات سفارشی'));
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

test("replaceTableById handles nested tables cleanly", () => {
  const sample = `<div><table id="invoice-items-table"><tr><td><table><tr><td>nested</td></tr></table></td></tr></table></div>`;
  const res = replaceTableById(sample, "invoice-items-table", '<table id="new"><tr><td>replaced</td></tr></table>');
  assert.equal(res, '<div><table id="new"><tr><td>replaced</td></tr></table></div>');
});

test("injectStyleTag handles head with whitespace or missing head", () => {
  const withHead = `<html><head><title>Test</title> </head ><body>Content</body></html>`;
  const res = injectStyleTag(withHead, "body { color: red; }");
  assert.ok(res.includes("<style>\nbody { color: red; }\n</style>"));

  const noHead = `<html><body>Content</body></html>`;
  const resNoHead = injectStyleTag(noHead, "body { color: red; }");
  assert.ok(resNoHead.includes("<style>\nbody { color: red; }\n</style>"));
});
