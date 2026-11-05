import assert from "node:assert/strict";
import { test } from "node:test";

import { stockStatus, stockTotals, STOCK_STATUS_LABEL } from "./stock-status.ts";

test("stockStatus returns 'empty' when quantity <= 0", () => {
  assert.equal(stockStatus({ quantity: 0, isLowStock: false }), "empty");
  assert.equal(stockStatus({ quantity: -1, isLowStock: false }), "empty");
  assert.equal(stockStatus({ quantity: -5.5, isLowStock: true }), "empty");
});

test("stockStatus returns 'low' when isLowStock and quantity > 0", () => {
  assert.equal(stockStatus({ quantity: 1, isLowStock: true }), "low");
  assert.equal(stockStatus({ quantity: 3, isLowStock: true }), "low");
});

test("stockStatus returns 'ok' when quantity > 0 and not low", () => {
  assert.equal(stockStatus({ quantity: 3, isLowStock: false }), "ok");
  assert.equal(stockStatus({ quantity: 5, isLowStock: false }), "ok");
});

test("STOCK_STATUS_LABEL contains correct translations", () => {
  assert.equal(STOCK_STATUS_LABEL.empty, "بدون موجودی");
  assert.equal(STOCK_STATUS_LABEL.low, "زیر نقطهٔ سفارش");
  assert.equal(STOCK_STATUS_LABEL.ok, "کافی");
});

test("stockTotals counts low and empty correctly", () => {
  const result = stockTotals([
    { quantity: 3, isLowStock: true, fifoValuation: 100 },
    { quantity: 0, isLowStock: true, fifoValuation: 0 },
    { quantity: 5, isLowStock: false, fifoValuation: 250 },
  ]);
  assert.equal(result.lowCount, 1);
  assert.equal(result.emptyCount, 1);
  assert.equal(result.value, 350);
});

test("stockTotals returns zeros for empty array", () => {
  const result = stockTotals([]);
  assert.equal(result.lowCount, 0);
  assert.equal(result.emptyCount, 0);
  assert.equal(result.value, 0);
});

test("stockTotals sums fifoValuation correctly", () => {
  const result = stockTotals([
    { quantity: 1, isLowStock: false, fifoValuation: 100 },
    { quantity: 2, isLowStock: true, fifoValuation: 200 },
    { quantity: 0, isLowStock: false, fifoValuation: 300 },
  ]);
  assert.equal(result.lowCount, 1);
  assert.equal(result.emptyCount, 1);
  assert.equal(result.value, 600);
});
