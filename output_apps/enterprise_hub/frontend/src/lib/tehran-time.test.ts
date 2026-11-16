import test from "node:test";
import assert from "node:assert/strict";
import { tehranWallTimeToIso } from "./tehran-time.ts";

test("tehranWallTimeToIso reads wall time as Asia/Tehran (UTC+3:30, no DST since 2022)", () => {
  assert.equal(tehranWallTimeToIso("2025-01-15", "08:00"), "2025-01-15T04:30:00.000Z");
  assert.equal(tehranWallTimeToIso("2025-07-15", "08:00"), "2025-07-15T04:30:00.000Z");
  assert.equal(tehranWallTimeToIso("2025-01-15", "01:00"), "2025-01-14T21:30:00.000Z");
});

test("tehranWallTimeToIso rejects malformed input", () => {
  assert.equal(tehranWallTimeToIso("", "08:00"), null);
  assert.equal(tehranWallTimeToIso("2025-01-15", "8am"), null);
});
