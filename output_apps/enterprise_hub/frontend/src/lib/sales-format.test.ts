import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSalesMoney,
  formatSalesQuantity,
} from "../components/sales/sales-format.ts";

test("formatSalesMoney formats rial amounts with Persian separators", () => {
  assert.equal(formatSalesMoney(null), "—");
  assert.equal(formatSalesMoney(undefined), "—");
  assert.equal(formatSalesMoney(""), "—");
  assert.ok(formatSalesMoney(50000).includes("۵۰"));
  assert.ok(formatSalesMoney("1250000").includes("۱٬۲۵۰") || formatSalesMoney("1250000").includes("۱،۲۵۰"));
});

test("formatSalesQuantity formats decimals with Persian digits", () => {
  assert.equal(formatSalesQuantity(null), "—");
  assert.equal(formatSalesQuantity(undefined), "—");
  assert.equal(formatSalesQuantity(""), "—");
  assert.equal(formatSalesQuantity("invalid"), "—");
  assert.ok(formatSalesQuantity(10).includes("۱۰"));
  assert.ok(formatSalesQuantity("12.5").includes("۱۲٫۵") || formatSalesQuantity("12.5").includes("۱۲.۵"));
});
