import assert from "node:assert/strict";
import test from "node:test";

import {
  canPartialPay,
  isValidNationalId,
  isValidSayadNumber,
  partialAmountError,
  sortByUrgency,
  statusesFor,
  toLatinDigits,
} from "./cheques-ui.ts";

test("sayad: 16 digits, not one repeated digit", () => {
  assert.equal(isValidSayadNumber("1234567890123456"), true);
  assert.equal(isValidSayadNumber("0000000000000000"), false);
  assert.equal(isValidSayadNumber("12345"), false);
  assert.equal(isValidSayadNumber("123456789012345a"), false);
  assert.equal(toLatinDigits(" ۱۲۳٤ "), "1234");
});

test("national id: person check digit and company weighted check", () => {
  assert.equal(isValidNationalId("0499370899"), true);
  assert.equal(isValidNationalId("0499370890"), false);
  assert.equal(isValidNationalId("1111111111"), false);
  const company = [...Array(10).keys()].map((d) => `1010000001${d}`).filter(isValidNationalId);
  assert.equal(company.length, 1);
  assert.equal(isValidNationalId("12345"), false);
});

test("statuses per direction: delivered only for issued, spent only for received", () => {
  assert.ok(statusesFor("issued").includes("delivered"));
  assert.ok(!statusesFor("issued").includes("spent"));
  assert.ok(statusesFor("received").includes("spent"));
  assert.ok(!statusesFor("received").includes("delivered"));
  assert.equal(statusesFor("all").length, 7);
});

test("partial payment is offered only while collecting and with a remainder", () => {
  assert.equal(canPartialPay({ direction: "received", status: "deposited", remainingAmount: 10 }), true);
  assert.equal(canPartialPay({ direction: "received", status: "bounced", remainingAmount: 10 }), false);
  assert.equal(canPartialPay({ direction: "issued", status: "delivered", remainingAmount: "10.5" }), true);
  assert.equal(canPartialPay({ direction: "issued", status: "cleared", remainingAmount: 10 }), false);
  assert.equal(canPartialPay({ direction: "issued", status: "registered", remainingAmount: 0 }), false);
});

test("partial amount: positive, below the remainder, two decimals", () => {
  assert.equal(partialAmountError("30", 100), null);
  assert.notEqual(partialAmountError("۳۰٫۵", 100), null); // Persian decimal separator is not accepted
  assert.equal(partialAmountError("30.55", 100), null);
  assert.notEqual(partialAmountError("0", 100), null);
  assert.notEqual(partialAmountError("100", 100), null);
  assert.notEqual(partialAmountError("30.555", 100), null);
  assert.notEqual(partialAmountError("abc", 100), null);
});

test("urgency sort puts overdue open cheques first, closed last", () => {
  const rows = [
    { id: 1, dueDate: "2026-12-01", status: "registered" as const },
    { id: 2, dueDate: "2026-10-01", status: "cleared" as const },
    { id: 3, dueDate: "2026-10-20", status: "bounced" as const },
    { id: 4, dueDate: "2026-11-05", status: "deposited" as const },
  ];
  assert.deepEqual(sortByUrgency(rows, "2026-11-01").map((r) => r.id), [3, 4, 1, 2]);
});
