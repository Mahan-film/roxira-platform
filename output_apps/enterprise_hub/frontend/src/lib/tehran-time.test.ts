import test from "node:test";
import assert from "node:assert/strict";
import { formatTehranTime, tehranDateIso, tehranWallTimeToIso } from "./tehran-time.ts";

test("tehranDateIso uses the Tehran calendar day, not UTC", () => {
  assert.equal(tehranDateIso(new Date("2025-01-14T21:00:00.000Z")), "2025-01-15");
  assert.equal(tehranDateIso(new Date("2025-01-14T20:00:00.000Z")), "2025-01-14");
});

test("formatTehranTime renders Tehran wall time", () => {
  assert.equal(formatTehranTime("2025-01-15T04:30:00.000Z"), "08:00");
  assert.equal(formatTehranTime("2025-01-14T21:30:00.000Z"), "01:00");
  assert.equal(formatTehranTime("garbage"), null);
});

test("tehranWallTimeToIso reads wall time as Asia/Tehran (UTC+3:30, no DST since 2022)", () => {
  assert.equal(tehranWallTimeToIso("2025-01-15", "08:00"), "2025-01-15T04:30:00.000Z");
  assert.equal(tehranWallTimeToIso("2025-07-15", "08:00"), "2025-07-15T04:30:00.000Z");
  assert.equal(tehranWallTimeToIso("2025-01-15", "01:00"), "2025-01-14T21:30:00.000Z");
});

test("tehranWallTimeToIso rejects malformed input", () => {
  assert.equal(tehranWallTimeToIso("", "08:00"), null);
  assert.equal(tehranWallTimeToIso("2025-01-15", "8am"), null);
});
