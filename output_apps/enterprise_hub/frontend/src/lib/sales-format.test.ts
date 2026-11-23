import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLineTotalMinor,
  formatSalesMoney,
  formatSalesQuantity,
  parseNonNegativeMinor,
  parsePositiveDecimalString,
  parsePositiveInt,
  subtractPositiveDecimals,
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

test("BigInt money and quantity helpers parse and compute without float math", () => {
  assert.equal(parsePositiveInt("12"), 12);
  assert.equal(parsePositiveInt("۱۲"), 12);
  assert.equal(parsePositiveInt("0"), null);
  assert.equal(parsePositiveInt("-1"), null);

  assert.equal(parseNonNegativeMinor("500000"), "500000");
  assert.equal(parseNonNegativeMinor("۵۰۰۰۰۰"), "500000");
  assert.equal(parseNonNegativeMinor("", true), "0");
  assert.equal(parseNonNegativeMinor("", false), null);
  assert.equal(parseNonNegativeMinor("12.5"), null);

  assert.equal(parsePositiveDecimalString("2.5"), "2.5");
  assert.equal(parsePositiveDecimalString("0"), null);

  assert.equal(computeLineTotalMinor("2", "50000", "10000"), "90000");
  assert.equal(computeLineTotalMinor("1.5", "10000", "0"), "15000");
  assert.equal(computeLineTotalMinor("1", "100", "500"), "0");

  assert.equal(subtractPositiveDecimals("10.5", "2.25"), "8.25");
  assert.equal(subtractPositiveDecimals("2", "5"), "0");
});
