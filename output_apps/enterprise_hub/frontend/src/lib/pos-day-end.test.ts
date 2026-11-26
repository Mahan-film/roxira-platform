import assert from "node:assert/strict";
import test from "node:test";

import { computeCashDiff, summarizePosDayEnd } from "./pos-day-end.ts";
import type { InvoiceResponseDto } from "../types/invoicing.ts";

test("summarizePosDayEnd totals cash, card, transfer, and grandTotal in bigint", () => {
  const invoices = [
    { id: 1, issueDate: "2026-11-26T08:00:00Z", totalAmount: "100000", paymentMethod: "cash" },
    { id: 2, issueDate: "2026-11-26T09:00:00Z", totalAmount: "250000", paymentMethod: "card" },
    { id: 3, issueDate: "2026-11-26T10:00:00Z", totalAmount: "50000", paymentMethod: "transfer" },
    { id: 4, issueDate: "2026-11-25T10:00:00Z", totalAmount: "999999", paymentMethod: "cash" },
  ] as unknown as InvoiceResponseDto[];

  const summary = summarizePosDayEnd(invoices, "2026-11-26");
  assert.equal(summary.invoiceCount, 3);
  assert.equal(summary.cashTotal, 100000n);
  assert.equal(summary.cardTotal, 250000n);
  assert.equal(summary.transferTotal, 50000n);
  assert.equal(summary.grandTotal, 400000n);
});

test("computeCashDiff computes exact, surplus, and shortage", () => {
  assert.equal(computeCashDiff(100000n, 100000n), 0n);
  assert.equal(computeCashDiff(100000n, 120000n), 20000n);
  assert.equal(computeCashDiff(100000n, 85000n), -15000n);
});
