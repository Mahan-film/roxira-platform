import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateClientRasgiriAndDiscount,
  effectiveChequeAmount,
  isCalculatorEligibleCheque,
  parseRateScaled,
  tehranTodayIso,
} from "./cheque-calculator.ts";

test("tehranTodayIso uses Asia/Tehran calendar day across UTC midnight boundary", () => {
  assert.equal(tehranTodayIso(new Date("2026-11-11T20:29:59Z")), "2026-11-11");
  assert.equal(tehranTodayIso(new Date("2026-11-11T20:30:00Z")), "2026-11-12");
});

test("cleared cheques with remainingAmount 0 are excluded and never fall back to face amount", () => {
  const cleared = { status: "cleared" as const, remainingAmount: 0, amount: 100_000_000 };
  const partial = { status: "deposited" as const, remainingAmount: 40_000_000, amount: 100_000_000 };
  const zeroOpen = { status: "registered" as const, remainingAmount: "0.00", amount: 50_000_000 };

  assert.equal(isCalculatorEligibleCheque(cleared), false);
  assert.equal(isCalculatorEligibleCheque(zeroOpen), false);
  assert.equal(isCalculatorEligibleCheque(partial), true);
  assert.equal(effectiveChequeAmount(cleared), 0);
  assert.equal(effectiveChequeAmount(partial), 40_000_000);
});

test("rasgiri hand-verified weighted average days and half-up rounding", () => {
  const r1 = calculateClientRasgiriAndDiscount(
    [
      { id: 1, amount: "10000000", dueDate: "2026-11-11" },
      { id: 2, amount: "20000000", dueDate: "2026-11-21" },
    ],
    0,
    "2026-11-01",
  );
  assert.equal(r1.weightedAverageDays, 17);
  assert.equal(r1.weightedMaturityDate, "2026-11-18");

  const r2 = calculateClientRasgiriAndDiscount(
    [
      { id: 1, amount: "10000000", dueDate: "2026-11-11" },
      { id: 2, amount: "90000000", dueDate: "2026-12-01" },
    ],
    0,
    "2026-11-01",
  );
  assert.equal(r2.weightedAverageDays, 28);
  assert.equal(r2.weightedMaturityDate, "2026-11-29");
});

test("discounting matches hand-verified 24% commercial figures", () => {
  const single = calculateClientRasgiriAndDiscount(
    [{ id: 1, amount: "1000000000", dueDate: "2027-01-30" }],
    24,
    "2026-11-01",
  );
  assert.equal(single.items[0].days, 90);
  assert.equal(single.totalDiscountDecimal, "59178082");
  assert.equal(single.netPresentValueDecimal, "940821918");
  assert.equal(single.items[0].effectivePeriodRatePercent, 5.92);

  const portfolio = calculateClientRasgiriAndDiscount(
    [
      { id: 1, amount: "500000000", dueDate: "2026-12-01" },
      { id: 2, amount: "500000000", dueDate: "2026-12-31" },
    ],
    24,
    "2026-11-01",
  );
  assert.equal(portfolio.items[0].discountDecimal, "9863014");
  assert.equal(portfolio.items[1].discountDecimal, "19726027");
  assert.equal(portfolio.totalDiscountDecimal, "29589041");
  assert.equal(portfolio.netPresentValueDecimal, "970410959");
});

test("BigInt money precision holds above Number.MAX_SAFE_INTEGER (2^53)", () => {
  const res = calculateClientRasgiriAndDiscount(
    [
      { id: 1, amount: "9007199254740993", dueDate: "2026-11-11" },
      { id: 2, amount: "1", dueDate: "2026-11-21" },
    ],
    0,
    "2026-11-01",
  );
  assert.equal(res.totalAmountDecimal, "9007199254740994");
  assert.equal(res.totalCount, 2);

  const hugeDecimal = calculateClientRasgiriAndDiscount(
    [{ id: 1, amount: "9876543210987654.32", dueDate: "2026-11-11" }],
    0,
    "2026-11-01",
  );
  assert.equal(hugeDecimal.totalAmountDecimal, "9876543210987654.32");
});

test("invalid manual rows and negative/excess rates are flagged instead of silently ignored", () => {
  assert.equal(parseRateScaled("-5"), null);
  assert.equal(parseRateScaled("101"), null);
  assert.equal(String(parseRateScaled("24.5")), "245000");

  const res = calculateClientRasgiriAndDiscount(
    [
      { id: "bad-amt", amount: "-500", dueDate: "2026-11-20" },
      { id: "bad-date", amount: "1000000", dueDate: "2026-02-31" },
      { id: "ok", amount: "1000000", dueDate: "2026-11-20" },
    ],
    18,
    "2026-11-01",
  );
  assert.equal(res.totalCount, 1);
  assert.deepEqual(
    res.invalidItems.map((i) => i.id),
    ["bad-amt", "bad-date"],
  );
});
