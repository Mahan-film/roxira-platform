import assert from "node:assert/strict";
import test from "node:test";

import {
  canPartialPay,
  chipTone,
  countByStatus,
  dueStripRows,
  isValidNationalId,
  isValidSayadNumber,
  newestEventWithEntry,
  partialAmountError,
  sortByUrgency,
  statusesFor,
  toMinorUnits,
  toLatinDigits,
  voucherNoticeText,
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

test("comparisons stay exact beyond 2^53 (no float rounding)", () => {
  assert.equal(String(toMinorUnits("9999999999999999.99")), "999999999999999999");
  assert.equal(String(toMinorUnits("12.5")), "1250");
  assert.equal(toMinorUnits("1.234"), null);
  assert.equal(String(toMinorUnits("۱۲")), "1200");
  // 9007199254740993 is not representable as a double; the cheque is one unit above the payment
  assert.equal(partialAmountError("9007199254740992", "9007199254740993"), null);
  assert.notEqual(partialAmountError("9007199254740993", "9007199254740993"), null);
  assert.equal(canPartialPay({ direction: "received", status: "deposited", remainingAmount: "0.00" }), false);
});

test("countByStatus counts rows per status", () => {
  assert.deepEqual(
    countByStatus([{ status: "registered" }, { status: "registered" }, { status: "bounced" }]),
    { registered: 2, bounced: 1 },
  );
  assert.deepEqual(countByStatus([]), {});
});

test("dueStripRows keeps one direction, urgency-sorted, limited", () => {
  const items = [
    { id: 1, dueDate: "2026-11-12", status: "registered" as const, direction: "received" as const },
    { id: 2, dueDate: "2026-11-08", status: "registered" as const, direction: "received" as const },
    { id: 3, dueDate: "2026-11-10", status: "registered" as const, direction: "received" as const },
    { id: 4, dueDate: "2026-11-09", status: "registered" as const, direction: "issued" as const },
  ];
  assert.deepEqual(
    dueStripRows(items, "received", "2026-11-06", 5).map((r) => r.id),
    [2, 3, 1],
  );
  assert.deepEqual(dueStripRows(items.filter((r) => r.direction === "issued"), "issued", "2026-11-06", 5).map((r) => r.id), [4]);
  assert.deepEqual(dueStripRows(items, "received", "2026-11-06", 2).map((r) => r.id), [2, 3]);
});

test("voucherNoticeText: with and without an entry number", () => {
  assert.equal(
    voucherNoticeText({ chequeNumber: "1024", statusLabel: "وصول‌شده", entryNumber: "1405-0231" }),
    "چک 1024: «وصول‌شده» ثبت شد. سند حسابداری 1405-0231 صادر شد.",
  );
  assert.equal(
    voucherNoticeText({ chequeNumber: "1024", statusLabel: "وصول‌شده", entryNumber: null }),
    "چک 1024: «وصول‌شده» ثبت شد. سند حسابداری صادر شد.",
  );
});

test("chipTone: success for cleared, danger for bounced/returned, info for deposited/delivered, neutral otherwise", () => {
  assert.equal(chipTone("cleared"), "success");
  assert.equal(chipTone("bounced"), "danger");
  assert.equal(chipTone("returned"), "danger");
  assert.equal(chipTone("deposited"), "info");
  assert.equal(chipTone("delivered"), "info");
  assert.equal(chipTone("registered"), "neutral");
  assert.equal(chipTone("spent"), "neutral");
});

test("newestEventWithEntry picks the latest event that has a journal entry (any input order)", () => {
  const events = [
    { id: 10, eventDate: "2026-11-06", journalEntryId: 501 },
    { id: 11, eventDate: "2026-11-07", journalEntryId: null },
    { id: 9, eventDate: "2026-11-05", journalEntryId: 499 },
  ];
  assert.deepEqual(newestEventWithEntry(events), { id: 10, eventDate: "2026-11-06", journalEntryId: 501 });
  assert.deepEqual(newestEventWithEntry([{ id: 12, eventDate: "2026-11-06", journalEntryId: null }, { id: 8, eventDate: "2026-11-06", journalEntryId: 300 }]), {
    id: 8,
    eventDate: "2026-11-06",
    journalEntryId: 300,
  });
  assert.equal(newestEventWithEntry([{ id: 1, eventDate: "2026-11-06", journalEntryId: null }]), null);
  assert.equal(newestEventWithEntry([]), null);
});
