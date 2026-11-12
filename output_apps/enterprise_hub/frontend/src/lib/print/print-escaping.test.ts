import assert from "node:assert/strict";
import { test } from "node:test";

import { Currency } from "../../types/currency.ts";
import {
  InvoiceDirection,
  InvoiceJurisdiction,
  InvoiceStatus,
  InvoiceSubject,
  type InvoiceResponseDto,
} from "../../types/invoicing.ts";
import type { PrintTemplateDto } from "../../types/print-template.ts";

import { buildSalesInvoiceHtml } from "./open-sales-invoice-window.ts";
import { renderTemplate } from "./render-template.ts";
import { safeLogoUrl } from "./safe-url.ts";

const XSS = `<script>alert(1)</script>`;
const ONERROR = `" onerror="alert(2)`;

test("renderTemplate escapes script and attribute-breaking payloads", () => {
  const html = renderTemplate(`<img src="{{logo}}"><p>{{t}}</p>`, { logo: ONERROR, t: XSS });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('" onerror="'));
  assert.ok(html.includes("&quot; onerror=&quot;"));
});

test("safeLogoUrl accepts http(s), local path and raster data URLs only", () => {
  assert.equal(safeLogoUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  assert.equal(safeLogoUrl("http://example.com/a.png"), "http://example.com/a.png");
  assert.equal(safeLogoUrl("/logos/a.png"), "/logos/a.png");
  assert.equal(safeLogoUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "//evil.example/x.png",
    'https://a.example/x.png" onerror="alert(1)',
    "https://a.example/<script>",
    "vbscript:x",
  ]) {
    assert.equal(safeLogoUrl(bad), "", bad);
  }
});

test("a sales invoice built from a hostile template carries no live script or javascript: logo", () => {
  const invoice = {
    id: "i",
    taxInvoiceNumber: "1",
    customerId: null,
    sellerInfo: { name: "x" },
    buyerInfo: { name: "y" },
    items: [
      { description: XSS, sku: ONERROR, quantity: 1, unitPrice: 1, discount: 0, vatRate: 0.1, tax: 1, total: 2 },
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
    totalAmount: 1,
    totalDiscount: 0,
    totalTax: 1,
    finalPayable: 2,
    createdAt: "2026-01-01T00:00:00Z",
  } as unknown as InvoiceResponseDto;
  const template = {
    paperSize: "A4",
    showLogo: true,
    logoUrl: "javascript:alert(3)",
    options: { headerTitle: XSS, footerNote: `${XSS}${ONERROR}` },
    columnsConfig: [
      { key: "description", label: XSS, visible: true, order: 1 },
      { key: "itemCode", label: ONERROR, visible: true, order: 2 },
    ],
  } as unknown as Partial<PrintTemplateDto>;
  const html = buildSalesInvoiceHtml(invoice, "صادر شده", template);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes('" onerror="'));
  assert.ok(html.includes("&lt;script&gt;"));
});
