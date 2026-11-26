import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { QUICK_CREATE } from "./nav-menu.ts";
import { stockStatus, STOCK_STATUS_LABEL } from "./stock-status.ts";

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

test("inventory table renders unit column + row menu and import is labeled ورود از اکسل", () => {
  const tableSrc = fs.readFileSync(
    new URL("../components/inventory/stock-items-table.tsx", import.meta.url),
    "utf8",
  );
  const importPageSrc = fs.readFileSync(
    new URL("../app/app/import/page.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(tableSrc.includes(">واحد</TableHead>"));
  assert.ok(tableSrc.includes("unitLabel(item.primaryUnit)"));
  assert.ok(tableSrc.includes("colSpan={8}"));
  assert.ok(tableSrc.includes("<RowActionsMenu"));
  assert.ok(tableSrc.includes("کارت کالا"));

  assert.ok(importPageSrc.includes('title="ورود از اکسل"'));
  const importQuick = QUICK_CREATE.find((entry) => entry.id === "import-file");
  assert.equal(importQuick?.label, "ورود از اکسل");
});
