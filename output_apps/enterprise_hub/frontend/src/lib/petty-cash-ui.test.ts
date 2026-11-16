import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lastSettlementDate,
  minorToMajorString,
  normalizeAmount,
  parseIntegerRial,
  sumMinorUnits,
} from "./petty-cash-ui.ts";

test("lastSettlementDate returns the greatest date among settled transactions", () => {
  assert.equal(
    lastSettlementDate([
      { status: "SETTLED", date: "2026-10-02" },
      { status: "PENDING", date: "2026-11-01" },
      { status: "SETTLED", date: "2026-10-20" },
    ]),
    "2026-10-20",
  );
});

test("lastSettlementDate returns null for an empty list", () => {
  assert.equal(lastSettlementDate([]), null);
});

test("lastSettlementDate returns null when nothing is settled", () => {
  assert.equal(lastSettlementDate([{ status: "PENDING", date: "2026-11-01" }]), null);
});

test("normalizeAmount accepts positive amounts and rejects the rest", () => {
  assert.equal(normalizeAmount("1,500,000"), "1500000");
  assert.equal(normalizeAmount("۱۲۰۰"), "1200");
  assert.equal(normalizeAmount("12.5"), "12.5");
  assert.equal(normalizeAmount("0"), null);
  assert.equal(normalizeAmount("0.00"), null);
  assert.equal(normalizeAmount("-5"), null);
  assert.equal(normalizeAmount("1.234"), null);
  assert.equal(normalizeAmount("abc"), null);
  assert.equal(normalizeAmount(""), null);
});

test("sumMinorUnits sums amounts using exact BigInt minor units without float loss", () => {
  assert.equal(sumMinorUnits([]), BigInt(0));
  assert.equal(sumMinorUnits([{ amount: "1500" }]), BigInt(150000));
  assert.equal(
    sumMinorUnits([
      { amount: "1,500,000.50" },
      { amount: "500000.25" },
      { amount: null },
      { amount: "" },
    ]),
    BigInt(200000075),
  );
  // Extremely large numbers exceeding 2^53 safe integer limit
  assert.equal(
    sumMinorUnits([
      { amount: "90000000000000000.01" },
      { amount: "10000000000000000.02" },
    ]),
    BigInt(10000000000000000003n),
  );
});

test("minorToMajorString formats BigInt minor units back to decimal string", () => {
  assert.equal(minorToMajorString(BigInt(0)), "0");
  assert.equal(minorToMajorString(BigInt(150000)), "1500");
  assert.equal(minorToMajorString(BigInt(200000075)), "2000000.75");
  assert.equal(minorToMajorString(BigInt(10000000000000000003n)), "100000000000000000.03");
  assert.equal(minorToMajorString(BigInt(-5000)), "-50");
});

test("sumMinorUnits handles fractional rounding on 3rd digit correctly", () => {
  // Input 1,500,000.505 rounds to 1,500,000.51 (51 cents)
  assert.equal(sumMinorUnits([{ amount: "1,500,000.505" }]), BigInt(150000051));
  // Input 1,500,000.504 rounds to 1,500,000.50 (50 cents)
  assert.equal(sumMinorUnits([{ amount: "1,500,000.504" }]), BigInt(150000050));
});

test("parseIntegerRial extracts exact BigInt for Rial values without float loss", () => {
  assert.equal(parseIntegerRial("1500000"), BigInt(1500000));
  assert.equal(parseIntegerRial("۱,۵۰۰,۰۰۰"), BigInt(1500000));
  assert.equal(parseIntegerRial(""), BigInt(0));
  assert.equal(parseIntegerRial("abc"), BigInt(0));
  assert.equal(parseIntegerRial("100.50"), BigInt(0));
});
