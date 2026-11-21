import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRialsInput } from "./barcode-price.ts";

test("parses grouped and Persian rial input without truncation", () => {
  assert.equal(parseRialsInput("12,500"), "12500");
  assert.equal(parseRialsInput("۱۲٬۵۰۰"), "12500");
  assert.equal(parseRialsInput("12.500"), "12500");
  assert.equal(parseRialsInput("  250000 "), "250000");
  assert.equal(parseRialsInput(""), undefined);
});

test("refuses fractions and junk instead of truncating", () => {
  assert.equal(parseRialsInput("1000.5"), null);
  assert.equal(parseRialsInput("12abc"), null);
  assert.equal(parseRialsInput("-5"), null);
});
