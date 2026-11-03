import assert from "node:assert/strict";
import { test } from "node:test";

import { formatJalaliNumericDate, formatMoney, formatNumber } from "./fa-format.ts";

test("rials and tomans use Persian digits, other codes Latin", () => {
  assert.equal(formatMoney(1500000), "۱٬۵۰۰٬۰۰۰ ریال");
  assert.equal(formatMoney(2500, "IRT"), "۲٬۵۰۰ تومان");
  assert.equal(formatMoney(1250, "EUR"), "1,250 EUR");
});

test("missing values show a dash, never NaN", () => {
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(Number.NaN, "USD"), "—");
  assert.equal(formatNumber(undefined), "—");
  assert.equal(formatJalaliNumericDate("garbage"), "—");
});

test("Jalali numeric date", () => {
  assert.equal(formatJalaliNumericDate("2026-03-21T12:00:00Z"), "۱۴۰۵/۱/۱");
});
