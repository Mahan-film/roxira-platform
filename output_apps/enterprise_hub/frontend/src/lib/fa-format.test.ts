import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAmount,
  formatJalaliNumericDate,
  formatMoney,
  formatNumber,
  formatReportMoney,
} from "./fa-format.ts";

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

test("one formatter, three units: rial, toman (÷10) and million rials", () => {
  assert.equal(formatAmount(1_234_567), "۱٬۲۳۴٬۵۶۷ ریال");
  assert.equal(formatAmount(1_234_567, "toman"), "۱۲۳٬۴۵۶٫۷ تومان");
  assert.equal(formatAmount(1_234_560, "toman"), "۱۲۳٬۴۵۶ تومان");
  assert.equal(formatAmount(51_234_567_890, "million"), "۵۱٬۲۳۴٫۶ میلیون ریال");
  assert.equal(formatAmount(-25_000, "toman"), "−۲٬۵۰۰ تومان");
});

test("tiles abbreviate, in the chosen base unit", () => {
  assert.equal(formatAmount(51_234_567_890, "rial", { abbreviate: true }), "۵۱٫۲ میلیارد ریال");
  assert.equal(formatAmount(51_234_567_890, "toman", { abbreviate: true }), "۵٫۱ میلیارد تومان");
  assert.equal(formatAmount(2_000_000_000_000, "rial", { abbreviate: true }), "۲ هزار میلیارد ریال");
  assert.equal(formatAmount(850_000_000, "million", { abbreviate: true }), "۸۵۰ میلیون ریال");
  assert.equal(formatAmount(98_000, "rial", { abbreviate: true }), "۹۸٬۰۰۰ ریال");
});

test("report amounts stay exact beyond the safe number range, negatives in brackets", () => {
  assert.equal(formatReportMoney("90000000000000000.01"), "۹۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٫۰۱");
  assert.equal(formatReportMoney("-1250.5"), "(۱٬۲۵۰٫۵۰)");
  assert.equal(formatReportMoney("1500000.00"), "۱٬۵۰۰٬۰۰۰");
  assert.equal(formatReportMoney("1500000", "toman"), "۱۵۰٬۰۰۰");
  assert.equal(formatReportMoney(""), "—");
  assert.equal(formatAmount("12abc"), "—");
});
