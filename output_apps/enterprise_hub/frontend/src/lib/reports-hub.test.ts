import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ALL_REPORT_KEYS, REPORT_GROUPS, parseReportTab, reportHref } from "./reports-hub";

const EXPECTED_KEYS = [
  "balance-sheet",
  "income-statement",
  "cash-flow",
  "equity-changes",
  "trial-balance",
  "subsidiary",
  "ledger",
  "journal-book",
  "general-ledger-book",
  "chart-of-accounts",
  "ageing",
  "party-statement",
];

const EXPECTED_GROUPS = [
  {
    id: "statements",
    title: "صورت‌های مالی",
    reports: [
      { key: "balance-sheet", title: "ترازنامه", description: "وضعیت دارایی‌ها، بدهی‌ها و حقوق مالکانه در یک تاریخ" },
      { key: "income-statement", title: "سود و زیان", description: "درآمد، هزینه و سود یا زیان یک دوره" },
      { key: "cash-flow", title: "جریان نقد", description: "ورود و خروج نقد در یک دوره" },
      { key: "equity-changes", title: "تغییرات حقوق مالکانه", description: "تغییر سرمایه، اندوخته و سود انباشته در یک دوره" },
    ],
  },
  {
    id: "books",
    title: "دفاتر و تراز",
    reports: [
      { key: "trial-balance", title: "تراز آزمایشی", description: "مانده بدهکار و بستانکار حساب‌ها" },
      { key: "subsidiary", title: "تراز تفصیلی", description: "مانده معین‌ها به تفکیک تفصیلی" },
      { key: "ledger", title: "دفتر کل و معین", description: "گردش یک حساب یا یک معین" },
      { key: "journal-book", title: "دفتر روزنامه", description: "همه اسناد به ترتیب تاریخ و شماره" },
      { key: "general-ledger-book", title: "دفتر کل (چاپی)", description: "دفتر کل آماده چاپ" },
      { key: "chart-of-accounts", title: "سرفصل حساب‌ها", description: "فهرست کامل سرفصل‌ها برای خروجی" },
    ],
  },
  {
    id: "receivables",
    title: "مطالبات و بدهی‌ها",
    reports: [
      { key: "ageing", title: "گزارش سنی", description: "سن مطالبات و بدهی‌ها بر اساس روز گذشت" },
      { key: "party-statement", title: "صورت‌حساب طرف حساب", description: "گردش حساب یک مشتری یا تأمین‌کننده" },
    ],
  },
];

test("REPORT_GROUPS structure", () => {
  assert.equal(REPORT_GROUPS.length, 3);
  assert.deepEqual(REPORT_GROUPS, EXPECTED_GROUPS);
  assert.equal(REPORT_GROUPS.flatMap((g) => g.reports).length, 12);
  assert.equal(new Set(REPORT_GROUPS.flatMap((g) => g.reports.map((r) => r.key))).size, 12);
});

test("ALL_REPORT_KEYS", () => {
  assert.deepEqual(ALL_REPORT_KEYS, EXPECTED_KEYS);
});

test("reportHref", () => {
  assert.equal(reportHref("ageing"), "/app/accounting/reports?tab=ageing");
  assert.equal(reportHref("balance-sheet"), "/app/accounting/reports?tab=balance-sheet");
});

test("parseReportTab", () => {
  assert.equal(parseReportTab("ageing"), "ageing");
  assert.equal(parseReportTab("bogus"), null);
  assert.equal(parseReportTab(null), null);
  assert.equal(parseReportTab(""), null);
});
