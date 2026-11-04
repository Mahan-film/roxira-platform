import assert from "node:assert/strict";
import { test } from "node:test";

import { csvCell, parseMinQuantity, reorderCsv, shortfall, sortByShortfall } from "./reorder.ts";

const item = (sku: string, quantity: number, minQuantity: number) => ({
  sku,
  barcode: `B-${sku}`,
  name: `کالای ${sku}`,
  quantity,
  minQuantity,
});

test("shortfall is minimum minus on hand, never negative", () => {
  assert.equal(shortfall({ quantity: 3, minQuantity: 10 }), 7);
  assert.equal(shortfall({ quantity: 10, minQuantity: 10 }), 0);
  assert.equal(shortfall({ quantity: 12, minQuantity: 10 }), 0);
  assert.equal(shortfall({ quantity: -2, minQuantity: 5 }), 7);
  assert.equal(shortfall({ quantity: 0.1, minQuantity: 0.3 }), 0.2);
});

test("sorts largest shortfall first, then by sku", () => {
  const sorted = sortByShortfall([item("B", 5, 6), item("C", 0, 10), item("A", 5, 6)]);
  assert.deepEqual(sorted.map((row) => row.sku), ["C", "A", "B"]);
});

test("csv cells neutralise spreadsheet formulas and quote separators", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+98"), "'+98");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
  assert.equal(csvCell("پیچ, مهره"), "\"پیچ, مهره\"");
  assert.equal(csvCell("A-1"), "A-1");
});

test("reorder csv has a header and one row per item, largest shortfall first", () => {
  const csv = reorderCsv([item("A", 8, 10), item("=B", 0, 2.5)]);
  assert.equal(
    csv,
    [
      "sku,barcode,name,on_hand,min_quantity,shortfall",
      "'=B,B-=B,کالای =B,0,2.5,2.5",
      "A,B-A,کالای A,8,10,2",
    ].join("\n"),
  );
});

test("parses a minimum quantity, Persian digits allowed", () => {
  assert.equal(parseMinQuantity("۱۲"), 12);
  assert.equal(parseMinQuantity(" 2.5 "), 2.5);
  assert.equal(parseMinQuantity("۳٫۷۵"), 3.75);
  assert.equal(parseMinQuantity("0"), 0);
  assert.equal(parseMinQuantity(""), null);
  assert.equal(parseMinQuantity("-1"), null);
  assert.equal(parseMinQuantity("1.234"), null);
  assert.equal(parseMinQuantity("abc"), null);
});
