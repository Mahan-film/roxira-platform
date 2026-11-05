import assert from "node:assert/strict";
import { test } from "node:test";

import { balanceMarker } from "./balance.ts";

test("debit, credit and zero markers", () => {
  assert.deepEqual(balanceMarker("12500000"), { side: "debit", label: "بد", abs: "12500000" });
  assert.deepEqual(balanceMarker("-12500000"), { side: "credit", label: "بس", abs: "12500000" });
  assert.equal(balanceMarker("0.00")?.label, "بی\u200cحساب");
  assert.equal(balanceMarker("-0.00")?.side, "zero");
  assert.equal(balanceMarker(0)?.side, "zero");
  assert.equal(balanceMarker(BigInt(5))?.side, "debit");
});

test("large decimal strings stay exact", () => {
  assert.equal(balanceMarker("-9007199254740993.50")?.abs, "9007199254740993.50");
});

test("missing or non-numeric input has no marker", () => {
  assert.equal(balanceMarker("abc"), null);
  assert.equal(balanceMarker(null), null);
  assert.equal(balanceMarker(""), null);
  assert.equal(balanceMarker(Number.NaN), null);
});
