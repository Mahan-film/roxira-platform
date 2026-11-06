import { test } from "node:test";
import assert from "node:assert/strict";

import { bankLabel, lastStatementDate, unreconciledCount } from "./bank-accounts-ui.ts";

test("unreconciledCount adds statement and book counts", () => {
  assert.equal(unreconciledCount({ unmatchedStatementCount: 2, unmatchedBookCount: 3 }), 5);
});

test("unreconciledCount of two zeros is zero", () => {
  assert.equal(unreconciledCount({ unmatchedStatementCount: 0, unmatchedBookCount: 0 }), 0);
});

test("lastStatementDate returns the greatest ISO date", () => {
  assert.equal(
    lastStatementDate([
      { txnDate: "2026-10-02" },
      { txnDate: "2026-11-01" },
      { txnDate: "2026-09-30" },
    ]),
    "2026-11-01",
  );
});

test("lastStatementDate is null for no lines", () => {
  assert.equal(lastStatementDate([]), null);
});

test("lastStatementDate with a single line returns its date", () => {
  assert.equal(lastStatementDate([{ txnDate: "2026-05-05" }]), "2026-05-05");
});

test("bankLabel returns the Persian bank name", () => {
  assert.equal(bankLabel("mellat"), "ملت");
});
