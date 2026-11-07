import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCOUNTING_VOUCHER_A4_TEMPLATE } from "../../print-templates/accounting-voucher-a4.template.ts";
import type { JournalEntryResponse } from "../../types/accounting.ts";

import { mapJournalEntryToVoucherData } from "./accounting-voucher.ts";
import { renderTemplate } from "./render-template.ts";

const entry = (overrides: Partial<JournalEntryResponse> = {}) =>
  ({
    id: 1,
    entryNumber: "JV-1405-0007",
    date: "2026-03-21",
    description: "خرید لوازم اداری",
    status: "POSTED",
    currency: "IRR",
    totalDebit: 1500000,
    totalCredit: 1500000,
    baseCurrency: "IRR",
    baseTotalDebit: 1500000,
    baseTotalCredit: 1500000,
    lines: [
      { id: 1, accountCode: "6010", accountName: "هزینه اداری", debit: 1500000, credit: 0, description: "کاغذ" },
      { id: 2, accountCode: "1010", accountName: "صندوق", debit: 0, credit: 1500000 },
    ],
    ...overrides,
  }) as unknown as JournalEntryResponse;

const printed = (value: JournalEntryResponse) =>
  renderTemplate(ACCOUNTING_VOUCHER_A4_TEMPLATE, mapJournalEntryToVoucherData(value, "ثبت‌شده"));

test("fills every placeholder of the real template", () => {
  const html = printed(entry());
  assert.equal(html.includes("{{"), false);
  assert.ok(html.includes("JV-1405-0007"));
  assert.ok(html.includes("۱٬۵۰۰٬۰۰۰"));
  assert.ok(html.includes("هزینه اداری"));
  assert.ok(html.includes("<style>"));
});

test("shows the date in Jalali", () => {
  assert.ok(printed(entry()).includes("۱۴۰۵"));
});

test("a draft carries the watermark class and a posted voucher does not", () => {
  assert.ok(printed(entry({ status: "DRAFT" } as Partial<JournalEntryResponse>)).includes('class="is-draft"'));
  assert.equal(printed(entry()).includes('class="is-draft"'), false);
});

test("user text is escaped", () => {
  const html = printed(entry({ description: "<script>alert(1)</script>" }));
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("a zero side of a line stays blank", () => {
  const data = mapJournalEntryToVoucherData(entry(), "ثبت‌شده") as { lines: Array<{ debit: string; credit: string }> };
  assert.equal(data.lines[0].credit, "");
  assert.equal(data.lines[1].debit, "");
});

test("maps the working number and the permanent number to their two labelled fields", () => {
  const data = mapJournalEntryToVoucherData(
    entry({ entryNumber: "RV-9", permanentNumber: "17" }),
    "ثبت‌شده",
  ) as { voucherNumber: string; sequenceNumber: string };
  assert.equal(data.voucherNumber, "RV-9");
  assert.equal(data.sequenceNumber, "17");
});

test("a voucher with no permanent number prints a blank final number", () => {
  const data = mapJournalEntryToVoucherData(
    entry({ permanentNumber: null }),
    "ثبت‌شده",
  ) as { sequenceNumber: string };
  assert.equal(data.sequenceNumber, "");
});

test("the printed voucher labels both numbers", () => {
  const html = printed(entry({ entryNumber: "RV-9", permanentNumber: "17" }));
  assert.ok(html.includes("شمارهٔ سند (کاری)"));
  assert.ok(html.includes("شمارهٔ قطعی"));
  assert.ok(html.includes("RV-9"));
  assert.ok(html.includes("17"));
});
