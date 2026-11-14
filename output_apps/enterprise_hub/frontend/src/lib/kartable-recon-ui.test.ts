import { strict as assert } from "node:assert";
import { test } from "node:test";

import { filterReconRows, isNonZeroAmount } from "./kartable-recon-ui.ts";
import type { KartableReconciliationRow } from "../types/kartable-reconciliation.ts";

const SAMPLE_ROWS: KartableReconciliationRow[] = [
  {
    id: "1",
    section: "SALE",
    bucket: "matched",
    matchBy: "taxId",
    taxId: "TAX-001",
    invoiceNumber: "INV-101",
    issueDate: "2026-04-04",
    counterpartyName: "شرکت سپهر",
    ourInvoiceId: "u1",
    ourNetAmount: 1000000,
    ourVatAmount: 100000,
    ourTotalAmount: 1100000,
    kartableRowIndex: 2,
    kartableNetAmount: 1000000,
    kartableVatAmount: 100000,
    kartableTotalAmount: 1100000,
    vatDiff: 0,
    totalDiff: 0,
    note: null,
  },
  {
    id: "2",
    section: "SALE",
    bucket: "amount_difference",
    matchBy: "invoiceNumber",
    taxId: null,
    invoiceNumber: "INV-102",
    issueDate: "2026-04-05",
    counterpartyName: "بازرگانی الوند",
    ourInvoiceId: "u2",
    ourNetAmount: 500000,
    ourVatAmount: 50000,
    ourTotalAmount: 550000,
    kartableRowIndex: 3,
    kartableNetAmount: 500000,
    kartableVatAmount: 45000,
    kartableTotalAmount: 545000,
    vatDiff: -5000,
    totalDiff: -5000,
    note: "اختلاف مالیات ارزش افزوده",
  },
  {
    id: "3",
    section: "PURCHASE",
    bucket: "missing_in_our_system",
    matchBy: "none",
    taxId: "PUR-999",
    invoiceNumber: "PINV-999",
    issueDate: "2026-04-06",
    counterpartyName: "تأمین‌کننده آریا",
    ourInvoiceId: null,
    ourNetAmount: null,
    ourVatAmount: null,
    ourTotalAmount: null,
    kartableRowIndex: 4,
    kartableNetAmount: 200000,
    kartableVatAmount: 20000,
    kartableTotalAmount: 220000,
    vatDiff: 20000,
    totalDiff: 220000,
    note: "در کارپوشه موجود است ولی در سیستم ثبت نشده",
  },
];

test("filterReconRows filters by bucket, section, and Persian/Latin query", () => {
  assert.equal(filterReconRows(SAMPLE_ROWS, "all", "all", "").length, 3);
  assert.equal(filterReconRows(SAMPLE_ROWS, "amount_difference", "all", "").length, 1);
  assert.equal(filterReconRows(SAMPLE_ROWS, "all", "PURCHASE", "").length, 1);
  assert.equal(filterReconRows(SAMPLE_ROWS, "all", "all", "الوند")[0].id, "2");
  assert.equal(filterReconRows(SAMPLE_ROWS, "all", "all", "tax-001")[0].id, "1");
});

test("isNonZeroAmount handles zero strings, nulls, numbers, and large BigInt decimal strings", () => {
  assert.equal(isNonZeroAmount(0), false);
  assert.equal(isNonZeroAmount("0.00"), false);
  assert.equal(isNonZeroAmount("-0.00"), false);
  assert.equal(isNonZeroAmount(null), false);
  assert.equal(isNonZeroAmount(-5000), true);
  assert.equal(isNonZeroAmount("990000000000000.00"), true);
});
