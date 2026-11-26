import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXED_ASSET_METHOD_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  formatAssetDate,
  formatAssetMoney,
  formatDepreciationRunSummary,
  isValidJalaliPeriod,
  jalaliMonthLabel,
} from "./fixed-assets-ui.ts";

test("formats asset dates in Jalali calendar with Persian digits", () => {
  const formatted = formatAssetDate("2026-04-10");
  assert.match(formatted, /۱۴۰۵/);
  assert.match(formatted, /فروردین/);
  assert.equal(formatAssetDate(null), "—");
});

test("formats asset money with formatMoneyRial and Persian separators", () => {
  assert.equal(formatAssetMoney("120000000.00"), "۱۲۰٬۰۰۰٬۰۰۰ ریال");
  assert.equal(formatAssetMoney("0.00"), "۰ ریال");
  assert.equal(formatAssetMoney(null), "—");
});

test("maps status, method, and Jalali month labels in Persian", () => {
  assert.equal(FIXED_ASSET_STATUS_LABELS.ACTIVE, "فعال");
  assert.equal(FIXED_ASSET_STATUS_LABELS.DISPOSED, "فروش‌رفته");
  assert.equal(FIXED_ASSET_METHOD_LABELS.STRAIGHT_LINE, "خط مستقیم");
  assert.equal(FIXED_ASSET_METHOD_LABELS.DECLINING_BALANCE, "نزولی");
  assert.equal(jalaliMonthLabel(1), "فروردین");
  assert.equal(jalaliMonthLabel(12), "اسفند");
});

test("summarizes monthly depreciation run and validates Jalali period", () => {
  assert.equal(isValidJalaliPeriod("1405", 1), true);
  assert.equal(isValidJalaliPeriod("1299", 1), false);
  assert.equal(isValidJalaliPeriod("1405", 13), false);

  const summary = formatDepreciationRunSummary({
    year: 1405,
    month: 2,
    entryNumber: "JV-10",
    entryNumbers: ["JV-10"],
    totalCharged: "5000000.00",
    charged: [{ code: "FA-1", amount: "5000000.00" }],
    zeroCharge: [],
    skipped: [],
  });
  assert.match(summary, /اردیبهشت/);
  assert.match(summary, /۵٬۰۰۰٬۰۰۰ ریال/);
  assert.match(summary, /JV-10/);
});
