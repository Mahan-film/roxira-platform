import assert from "node:assert/strict";
import test from "node:test";

import {
  collectBankNames,
  csvSafeCell,
  filterPortfolioCheques,
  formatChequeMinorRial,
  minorStringToRial,
  summarizeByStatus,
} from "./cheques-report-ui.ts";
import type { Cheque } from "../types/cheques.ts";

function makeCheque(overrides: Partial<Cheque>): Cheque {
  return {
    id: 1,
    direction: "received",
    sayadNumber: "1234567890123456",
    sayadVerified: false,
    sayadRegistrationStatus: "registered",
    sayadVerifiedBy: null,
    sayadVerifiedAt: null,
    receiverNationalId: null,
    chequeNumber: "1001",
    bankName: "ملت",
    amount: 1_000_000,
    issueDate: "2026-11-01",
    dueDate: "2026-12-01",
    partyName: "شرکت الف",
    partyCode: "C01",
    spentToName: null,
    spentToCode: null,
    spentToNationalId: null,
    settledAmount: 0,
    remainingAmount: 1_000_000,
    status: "registered",
    allowedNext: ["deposited", "bounced"],
    description: null,
    ...overrides,
  };
}

test("minorStringToRial and formatChequeMinorRial convert minor units without precision loss", () => {
  assert.equal(minorStringToRial("100000000"), "1000000");
  assert.equal(minorStringToRial("12550"), "125.5");
  assert.equal(minorStringToRial("900719925474099300"), "9007199254740993");
  assert.equal(minorStringToRial(null), "0");
  assert.equal(formatChequeMinorRial("100000000", "rial"), "۱٬۰۰۰٬۰۰۰ ریال");
  assert.equal(formatChequeMinorRial("100000000", "toman"), "۱۰۰٬۰۰۰ تومان");
});

test("filterPortfolioCheques filters by direction, status, bank, and search text", () => {
  const rows: Cheque[] = [
    makeCheque({ id: 1, direction: "received", status: "registered", bankName: "ملت", partyName: "شرکت الف", chequeNumber: "1001" }),
    makeCheque({ id: 2, direction: "received", status: "bounced", bankName: "ملی", partyName: "شرکت ب", chequeNumber: "1002" }),
    makeCheque({ id: 3, direction: "issued", status: "delivered", bankName: "ملت", partyName: "تأمین ج", chequeNumber: "2001" }),
    makeCheque({ id: 4, direction: "received", status: "cleared", bankName: null, partyName: "شرکت د", chequeNumber: "1003" }),
  ];

  assert.deepEqual(filterPortfolioCheques(rows, { direction: "received" }).map((r) => r.id), [1, 2, 4]);
  assert.deepEqual(filterPortfolioCheques(rows, { status: "bounced" }).map((r) => r.id), [2]);
  assert.deepEqual(filterPortfolioCheques(rows, { bankName: "ملت" }).map((r) => r.id), [1, 3]);
  assert.deepEqual(filterPortfolioCheques(rows, { bankName: "سایر / نامشخص" }).map((r) => r.id), [4]);
  assert.deepEqual(filterPortfolioCheques(rows, { direction: "received", bankName: "ملت" }).map((r) => r.id), [1]);
  assert.deepEqual(filterPortfolioCheques(rows, { search: "1002" }).map((r) => r.id), [2]);
  assert.deepEqual(filterPortfolioCheques(rows, { search: "تأمین" }).map((r) => r.id), [3]);
});

test("summarizeByStatus aggregates counts and exact BigInt rial totals", () => {
  const rows = [
    makeCheque({ id: 1, status: "registered", remainingAmount: "9007199254740993" }),
    makeCheque({ id: 2, status: "registered", remainingAmount: "7" }),
    makeCheque({ id: 3, status: "bounced", remainingAmount: 500_000 }),
  ];
  const summary = summarizeByStatus(rows);
  assert.deepEqual(summary, [
    { status: "registered", count: 2, totalRial: "9007199254741000" },
    { status: "bounced", count: 1, totalRial: "500000" },
  ]);
});

test("collectBankNames merges register and maturity bank lists uniquely", () => {
  const names = collectBankNames(
    [makeCheque({ bankName: "ملت" }), makeCheque({ bankName: null }), makeCheque({ bankName: "پارسیان" })],
    [{ bankName: "ملی" }, { bankName: "ملت" }],
  );
  assert.equal(names.length, 3);
  assert.ok(names.includes("ملت"));
  assert.ok(names.includes("ملی"));
  assert.ok(names.includes("پارسیان"));
});

test("csvSafeCell neutralizes formula prefixes", () => {
  assert.equal(csvSafeCell("=SUM(A1)"), "\"'=SUM(A1)\"");
  assert.equal(csvSafeCell("+cmd"), "\"'+cmd\"");
  assert.equal(csvSafeCell("-100"), "\"'-100\"");
  assert.equal(csvSafeCell("@evil"), "\"'@evil\"");
  assert.equal(csvSafeCell('a"b'), '"a""b"');
});
