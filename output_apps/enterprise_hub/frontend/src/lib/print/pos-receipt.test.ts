import assert from "node:assert/strict";
import { test } from "node:test";

import { POS_RECEIPT_80MM_TEMPLATE } from "../../print-templates/pos-receipt-80mm.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";

import { mapInvoiceToPosReceiptData } from "./pos-receipt.ts";
import { renderTemplate } from "./render-template.ts";

const fixture = (overrides: Partial<InvoiceResponseDto> = {}): InvoiceResponseDto =>
  ({
    id: "pos-1",
    taxInvoiceNumber: "1405-000123",
    customerId: null,
    sellerInfo: { name: "فروشگاه نمونه" },
    buyerInfo: {},
    items: [
      {
        description: "کالای نمونه",
        quantity: 2,
        unitPrice: 500000,
        discount: 50000,
        vatRate: 0.1,
        tax: 95000,
        total: 1045000,
      },
    ],
    currency: "IRR",
    jurisdiction: "IR",
    exchangeRate: 1,
    fxRate: 0,
    amountFx: null,
    baseCurrency: "IRR",
    totalAmount: 1000000,
    totalDiscount: 50000,
    totalTax: 95000,
    finalPayable: 1045000,
    baseTotalAmount: 1000000,
    baseTotalTax: 95000,
    baseFinalPayable: 1045000,
    status: "PAID",
    issuedAt: "2026-11-05T10:00:00Z",
    paidAt: "2026-11-05T10:00:00Z",
    createdAt: "2026-11-05T10:00:00Z",
    direction: "SALE",
    einvoiceType: 2,
    subject: 1,
    relatedInvoiceId: null,
    warehouseId: null,
    ...overrides,
  }) as unknown as InvoiceResponseDto;

const printed = (invoice: InvoiceResponseDto) =>
  renderTemplate(POS_RECEIPT_80MM_TEMPLATE, mapInvoiceToPosReceiptData(invoice));

test("keeps the 80 mm roll width in the template CSS", () => {
  assert.ok(POS_RECEIPT_80MM_TEMPLATE.includes("size: 80mm auto"));
  assert.ok(POS_RECEIPT_80MM_TEMPLATE.includes("width:72mm"));
});

test("maps the shop header and receipt number", () => {
  const data = mapInvoiceToPosReceiptData(fixture());
  assert.equal(data.receiptNumber, "1405-000123");
  assert.deepEqual(data.shop, {
    name: "فروشگاه نمونه",
    address: "",
    phone: "",
    economicCode: "",
  });
  assert.equal((data.lines as Array<{ name: string }>)[0].name, "کالای نمونه");
});

test("formats amounts as integer rials with Persian digits", () => {
  const data = mapInvoiceToPosReceiptData(fixture());
  assert.deepEqual(data.lines, [
    { name: "کالای نمونه", quantity: "۲", unitPrice: "۵۰۰٬۰۰۰", lineTotal: "۱٬۰۴۵٬۰۰۰" },
  ]);
  assert.equal(data.subtotal, "۱٬۰۰۰٬۰۰۰");
  assert.equal(data.discount, "۵۰٬۰۰۰");
  assert.equal(data.vat, "۹۵٬۰۰۰");
  assert.equal(data.total, "۱٬۰۴۵٬۰۰۰");
});

test("shows the date in Jalali", () => {
  assert.equal(mapInvoiceToPosReceiptData(fixture()).dateJalali, "۱۴ آبان ۱۴۰۵");
});

test("leaves fields the POS sale response does not carry empty", () => {
  const data = mapInvoiceToPosReceiptData(fixture());
  assert.equal(data.time, "");
  assert.equal(data.cashier, "");
  assert.deepEqual(data.payments, []);
  assert.equal(data.change, "");
  assert.equal(data.taxId, "");
  assert.equal(data.trackingCode, "");
  assert.equal(data.footerText, "");
});

test("a zero discount stays empty and is hidden by the template", () => {
  const invoice = fixture({ totalDiscount: 0 });
  assert.equal(mapInvoiceToPosReceiptData(invoice).discount, "");
  assert.equal(printed(invoice).includes("تخفیف"), false);
});

test("escapes user text through the renderer", () => {
  const html = printed(fixture({ sellerInfo: { name: "<script>alert(1)</script>" } }));
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("fills every placeholder of the real template", () => {
  const html = printed(fixture());
  assert.equal(html.includes("{{"), false);
  assert.ok(html.includes("فروشگاه نمونه"));
  assert.ok(html.includes("1405-000123"));
  assert.ok(html.includes("۱٬۰۴۵٬۰۰۰"));
});
