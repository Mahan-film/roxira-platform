import assert from "node:assert/strict";
import { test } from "node:test";

import { isJalaliLeapYear, jalaliToIso } from "./jalali.ts";
import {
  checkJalaliText,
  jalaliPresets,
  maskJalaliInput,
  stepJalaliText,
  todayJalaliIso,
} from "./jalali-date-input.ts";

test("mask lays out digits as yyyy/mm/dd in Persian digits", () => {
  assert.equal(maskJalaliInput("14050814"), "۱۴۰۵/۰۸/۱۴");
  assert.equal(maskJalaliInput("1405"), "۱۴۰۵");
  assert.equal(maskJalaliInput("14050"), "۱۴۰۵/۰");
  assert.equal(maskJalaliInput("۱۴۰۵/۰۸/۱۴"), "۱۴۰۵/۰۸/۱۴");
  assert.equal(maskJalaliInput("1405/8/14"), "۱۴۰۵/۸۱/۴");
  assert.equal(maskJalaliInput("123456789"), "۱۲۳۴/۵۶/۷۸");
  assert.equal(maskJalaliInput(""), "");
});

test("known Jalali leap years", () => {
  for (const y of [1399, 1403, 1408, 1412]) assert.equal(isJalaliLeapYear(y), true, String(y));
  for (const y of [1400, 1401, 1402, 1404, 1405, 1406, 1407, 1409]) {
    assert.equal(isJalaliLeapYear(y), false, String(y));
  }
});

test("impossible dates are rejected, Esfand 30 only in leap years", () => {
  assert.equal(jalaliToIso("1403/12/30"), "2025-03-20");
  assert.equal(jalaliToIso("1404/12/30"), null);
  assert.equal(jalaliToIso("1408/12/30"), "2030-03-20");
  assert.equal(jalaliToIso("1405/12/30"), null);
  assert.equal(jalaliToIso("1405/12/29"), "2027-03-20");
  assert.equal(jalaliToIso("1405/07/31"), null);
  assert.equal(jalaliToIso("1405/06/31"), "2026-09-22");
  assert.equal(jalaliToIso("1405/13/01"), null);
  assert.equal(jalaliToIso("1405/00/10"), null);
});

test("check classifies empty, partial, valid and invalid text", () => {
  assert.equal(checkJalaliText("").state, "empty");
  assert.equal(checkJalaliText("۱۴۰۵/۰۸").state, "partial");
  const ok = checkJalaliText("۱۴۰۵/۰۸/۱۴");
  assert.equal(ok.state, "valid");
  assert.equal(ok.iso, "2026-11-05");
  assert.equal(checkJalaliText("۱۴۰۴/۱۲/۳۰").state, "invalid");
  const leap = checkJalaliText("۱۴۰۳/۱۲/۳۰");
  assert.equal(leap.state, "valid");
  assert.equal(leap.iso, "2025-03-20");
  assert.equal(checkJalaliText("۱۴۰۵/۱۳").state, "invalid");
  assert.equal(checkJalaliText("۱۴۰۵/۰۸/۳۲").state, "invalid");
});

test("arrow stepping crosses month and year edges with the real calendar", () => {
  assert.equal(stepJalaliText("۱۴۰۵/۰۸/۱۴", "day", 1), "۱۴۰۵/۰۸/۱۵");
  assert.equal(stepJalaliText("۱۴۰۵/۰۸/۳۰", "day", 1), "۱۴۰۵/۰۹/۰۱");
  assert.equal(stepJalaliText("۱۴۰۵/۱۲/۲۹", "day", 1), "۱۴۰۶/۰۱/۰۱");
  assert.equal(stepJalaliText("۱۴۰۳/۱۲/۲۹", "day", 1), "۱۴۰۳/۱۲/۳۰");
  assert.equal(stepJalaliText("۱۴۰۳/۱۲/۳۰", "day", 1), "۱۴۰۴/۰۱/۰۱");
  assert.equal(stepJalaliText("۱۴۰۵/۰۱/۰۱", "day", -1), "۱۴۰۴/۱۲/۲۹");
  assert.equal(stepJalaliText("۱۴۰۵/۰۷/۳۰", "month", 1), "۱۴۰۵/۰۸/۳۰");
  assert.equal(stepJalaliText("۱۴۰۵/۰۶/۳۱", "month", 1), "۱۴۰۵/۰۷/۳۰");
  assert.equal(stepJalaliText("۱۴۰۳/۱۲/۳۰", "year", 1), "۱۴۰۴/۱۲/۲۹");
  assert.equal(stepJalaliText("۱۴۰۵/۰۸", "day", 1), null);
});

test("today follows Tehran time, not UTC", () => {
  assert.equal(todayJalaliIso(new Date("2026-11-04T21:00:00Z")), "2026-11-05");
  assert.equal(todayJalaliIso(new Date("2026-11-04T10:00:00Z")), "2026-11-04");
});

test("presets: today, month, tax seasons and fiscal year", () => {
  const p = Object.fromEntries(jalaliPresets("2026-11-05").map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(p), ["today", "month", "spring", "summer", "autumn", "winter", "fiscal"]);
  assert.equal(p.today.label, "امروز");
  assert.deepEqual([p.today.from, p.today.to], ["2026-11-05", "2026-11-05"]);
  assert.deepEqual([p.month.from, p.month.to], ["2026-10-23", "2026-11-21"]);
  assert.deepEqual([p.spring.from, p.spring.to], ["2026-03-21", "2026-06-21"]);
  assert.deepEqual([p.summer.from, p.summer.to], ["2026-06-22", "2026-09-22"]);
  assert.deepEqual([p.autumn.from, p.autumn.to], ["2026-09-23", "2026-12-21"]);
  assert.deepEqual([p.winter.from, p.winter.to], ["2026-12-22", "2027-03-20"]);
  assert.deepEqual([p.fiscal.from, p.fiscal.to], ["2026-03-21", "2027-03-20"]);
  assert.equal(p.fiscal.label, "سال مالی ۱۴۰۵");
});

test("presets in a leap year end Esfand on the 30th", () => {
  const p = Object.fromEntries(jalaliPresets("2025-03-10").map((x) => [x.key, x]));
  assert.deepEqual([p.month.from, p.month.to], ["2025-02-19", "2025-03-20"]);
  assert.deepEqual([p.winter.from, p.winter.to], ["2024-12-21", "2025-03-20"]);
  assert.deepEqual([p.fiscal.from, p.fiscal.to], ["2024-03-20", "2025-03-20"]);
});
