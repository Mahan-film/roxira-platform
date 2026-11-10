import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSettlementTotals,
  getTreasuryKindLabel,
  getTreasuryMethodLabel,
  validateSettlementSubmission,
} from "./treasury-ui.ts";

test("computeSettlementTotals sums methods and calculates advance correctly", () => {
  const methods = [
    { amount: "10000000" },
    { amount: 5000000 },
  ];
  const allocations = [
    { amount: "8000000", writeoff: "200000" },
    { amount: 4000000, writeoff: 0 },
  ];

  const totals = computeSettlementTotals(methods, allocations);
  assert.equal(totals.totalMethods, 15000000);
  assert.equal(totals.totalAllocated, 12000000);
  assert.equal(totals.totalWriteoff, 200000);
  assert.equal(totals.advanceAmount, 3000000);
});

test("computeSettlementTotals with zero advance when exact match", () => {
  const methods = [{ amount: 10000000 }];
  const allocations = [{ amount: 10000000 }];

  const totals = computeSettlementTotals(methods, allocations);
  assert.equal(totals.totalMethods, 10000000);
  assert.equal(totals.totalAllocated, 10000000);
  assert.equal(totals.advanceAmount, 0);
});

test("validateSettlementSubmission checks party code", () => {
  assert.equal(
    validateSettlementSubmission({ partyCode: "", docDate: "1405-02-01", totalMethods: 100 }),
    "کد طرف‌حساب الزامی است.",
  );
});

test("validateSettlementSubmission checks doc date", () => {
  assert.equal(
    validateSettlementSubmission({ partyCode: "CUST-01", docDate: "", totalMethods: 100 }),
    "تاریخ سند الزامی است.",
  );
});

test("validateSettlementSubmission checks total methods > 0", () => {
  assert.equal(
    validateSettlementSubmission({ partyCode: "CUST-01", docDate: "1405-02-01", totalMethods: 0 }),
    "مبلغ روش‌های پرداخت باید بیشتر از صفر باشد.",
  );
});

test("validateSettlementSubmission succeeds for valid data", () => {
  assert.equal(
    validateSettlementSubmission({
      partyCode: "CUST-01",
      docDate: "1405-02-01",
      totalMethods: 5000000,
    }),
    null,
  );
});

test("labels match Persian translations", () => {
  assert.equal(getTreasuryMethodLabel("cash"), "نقد (صندوق)");
  assert.equal(getTreasuryMethodLabel("bank_transfer"), "واریز بانکی / حواله");
  assert.equal(getTreasuryKindLabel("receipt"), "رسید دریافت");
  assert.equal(getTreasuryKindLabel("payment"), "رسید پرداخت");
});
