import assert from "node:assert/strict";
import { test } from "node:test";

import { WAREHOUSE_DOCUMENT_A4_TEMPLATE } from "../../print-templates/warehouse-document-a4.template.ts";
import type { StockDocument, StockDocumentType } from "../../types/inventory.ts";

import { renderTemplate } from "./render-template.ts";
import { mapStockDocumentToWarehouseA4Data } from "./warehouse-document.ts";

const WAREHOUSES: Record<number, string> = { 1: "انبار مرکزی", 2: "انبار فروش" };
const name = (id: number | null) => (id === null ? "" : WAREHOUSES[id] ?? "");

const receipt: StockDocument = {
  id: 1,
  docNumber: "WD-1405-0001",
  docType: "PURCHASE_RECEIPT",
  status: "POSTED",
  docDate: "2026-11-05",
  fromWarehouseId: null,
  toWarehouseId: 2,
  reference: "INV-77",
  note: "رسید آزمایشی",
  totalValue: 5000000,
  createdAt: "2026-11-05T10:00:00Z",
  lines: [{ id: 1, sku: "SKU-1", quantity: 5, unitCost: 1000000, value: 5000000, batchNumber: null }],
};

const issue: StockDocument = {
  id: 2,
  docNumber: "WD-1405-0002",
  docType: "SALES_DELIVERY",
  status: "POSTED",
  docDate: "2026-11-05",
  fromWarehouseId: 1,
  toWarehouseId: null,
  reference: "SO-9",
  note: null,
  totalValue: 750000,
  createdAt: "2026-11-05T11:00:00Z",
  lines: [{ id: 1, sku: "SKU-9", quantity: 3, unitCost: 250000, value: 750000, batchNumber: null }],
};

test("maps a receipt with hand-written Persian quantities and rial amounts", () => {
  const data = mapStockDocumentToWarehouseA4Data(receipt, name);
  assert.equal(data.docTitle, "رسید انبار");
  assert.equal(data.documentNumber, "WD-1405-0001");
  assert.equal((data.warehouse as { name: string }).name, "انبار فروش");
  assert.equal(data.counterpartyLabel, "تأمین‌کننده");
  assert.equal((data.counterparty as { name: string }).name, "");
  assert.equal(data.referenceNumber, "INV-77");
  assert.equal(data.isDraft, false);
  const line = (data.lines as Array<Record<string, string>>)[0];
  assert.equal(line.row, "۱");
  assert.equal(line.itemCode, "SKU-1");
  assert.equal(line.quantity, "۵");
  assert.equal(line.unitCost, "۱٬۰۰۰٬۰۰۰");
  assert.equal(line.amount, "۵٬۰۰۰٬۰۰۰");
  const totals = data.totals as Record<string, string>;
  assert.equal(totals.quantity, "۵");
  assert.equal(totals.amount, "۵٬۰۰۰٬۰۰۰");
});

test("maps an issue (delivery) with hand-written Persian quantities and rial amounts", () => {
  const data = mapStockDocumentToWarehouseA4Data(issue, name);
  assert.equal(data.docTitle, "حواله انبار");
  assert.equal((data.warehouse as { name: string }).name, "انبار مرکزی");
  assert.equal(data.counterpartyLabel, "مشتری");
  const line = (data.lines as Array<Record<string, string>>)[0];
  assert.equal(line.quantity, "۳");
  assert.equal(line.unitCost, "۲۵۰٬۰۰۰");
  assert.equal(line.amount, "۷۵۰٬۰۰۰");
  const totals = data.totals as Record<string, string>;
  assert.equal(totals.quantity, "۳");
  assert.equal(totals.amount, "۷۵۰٬۰۰۰");
});

test("a transfer fills the destination warehouse and its counterparty", () => {
  const transfer: StockDocument = { ...receipt, docType: "TRANSFER", fromWarehouseId: 1, toWarehouseId: 2 };
  const data = mapStockDocumentToWarehouseA4Data(transfer, name);
  assert.equal(data.docTitle, "حواله انتقال بین انبارها");
  assert.equal((data.warehouse as { name: string }).name, "انبار مرکزی");
  assert.equal((data.destinationWarehouse as { name: string }).name, "انبار فروش");
  assert.equal(data.counterpartyLabel, "انبار مقصد");
  assert.equal((data.counterparty as { name: string }).name, "انبار فروش");
});

test("uses the Persian title of every document type", () => {
  const titles: Record<StockDocumentType, string> = {
    OPENING: "رسید انبار",
    PURCHASE_RECEIPT: "رسید انبار",
    SALES_DELIVERY: "حواله انبار",
    ADJUSTMENT: "سند تعدیل انبار",
    TRANSFER: "حواله انتقال بین انبارها",
  };
  for (const [docType, title] of Object.entries(titles)) {
    const data = mapStockDocumentToWarehouseA4Data({ ...receipt, docType: docType as StockDocumentType }, name);
    assert.equal(data.docTitle, title);
  }
});

test("a draft carries the watermark class and a posted document does not", () => {
  const draft = renderTemplate(
    WAREHOUSE_DOCUMENT_A4_TEMPLATE,
    mapStockDocumentToWarehouseA4Data({ ...receipt, status: "DRAFT" }, name),
  );
  // The template body class is `{{#if isDraft}}is-draft{{/if}} {{#if hideCost}}...`, so a draft
  // renders `class="is-draft "` (trailing space); match the class token, not the closing quote.
  assert.ok(draft.includes('class="is-draft'));
  const posted = renderTemplate(WAREHOUSE_DOCUMENT_A4_TEMPLATE, mapStockDocumentToWarehouseA4Data(receipt, name));
  assert.equal(posted.includes('class="is-draft'), false);
});

test("escapes user text through the renderer", () => {
  const html = renderTemplate(
    WAREHOUSE_DOCUMENT_A4_TEMPLATE,
    mapStockDocumentToWarehouseA4Data({ ...receipt, reference: "<b>x</b>", note: "<script>alert(1)</script>" }, name),
  );
  assert.equal(html.includes("<b>x</b>"), false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the real template renders with no placeholder left behind", () => {
  const html = renderTemplate(WAREHOUSE_DOCUMENT_A4_TEMPLATE, mapStockDocumentToWarehouseA4Data(receipt, name));
  assert.equal(html.includes("{{"), false);
  assert.ok(html.includes("WD-1405-0001"));
  assert.ok(html.includes("۱۴۰۵"));
  assert.ok(html.includes("<style>"));
});
