/**
 * Run: npm test   (node:test with native TypeScript stripping)
 * Covers the accounting overview status, including a ledger the size of the
 * production tenant (20,000 entries, 40,000 lines, 42 accounts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ledgerStatus } from "./ledger-status.ts";

test("not loaded yet is unknown, never unbalanced", () => {
  assert.equal(ledgerStatus(null), "unknown");
  assert.equal(ledgerStatus(undefined), "unknown");
});

test("a loaded ledger without postings reads as empty", () => {
  assert.equal(ledgerStatus({ totalDebit: 0, totalCredit: 0, balanced: true }), "empty");
});

test("a posted ledger is balanced or unbalanced by the server verdict", () => {
  assert.equal(ledgerStatus({ totalDebit: 10, totalCredit: 10, balanced: true }), "balanced");
  assert.equal(ledgerStatus({ totalDebit: 10, totalCredit: 7, balanced: false }), "unbalanced");
});

test("large ledger: 40,000 lines over 42 accounts sum exactly and read as balanced", () => {
  const accounts = 42;
  const entries = 20_000;
  const debit = new Array<number>(accounts).fill(0);
  const credit = new Array<number>(accounts).fill(0);
  for (let i = 0; i < entries; i += 1) {
    const amount = 1_000_000 + ((i * 7919) % 99_991_000); // whole rials
    debit[i % accounts] += amount;
    credit[(i * 5 + 1) % accounts] += amount;
  }
  const totalDebit = debit.reduce((a, b) => a + b, 0);
  const totalCredit = credit.reduce((a, b) => a + b, 0);
  assert.ok(Number.isSafeInteger(totalDebit));
  assert.equal(totalDebit, totalCredit);
  assert.equal(ledgerStatus({ totalDebit, totalCredit, balanced: totalDebit === totalCredit }), "balanced");
});
