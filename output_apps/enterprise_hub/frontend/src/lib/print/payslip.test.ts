import assert from "node:assert/strict";
import { test } from "node:test";

import { PAYSLIP_A5_TEMPLATE } from "../../print-templates/payslip-a5.template.ts";
import { PayslipStatus, type Payslip } from "../../types/hr.ts";

import { mapPayslipToA5Data } from "./payslip.ts";
import { renderTemplate } from "./render-template.ts";

const fixture = (overrides: Partial<Payslip> = {}): Payslip =>
  ({
    id: 1,
    payslipNumber: "PS-1405-0001",
    employeeId: 7,
    employeeFullName: "علی رضایی",
    employeeNumber: "1042",
    contractId: 3,
    periodYear: 1405,
    periodMonth: 8,
    baseSalary: 10000000,
    housingAllowance: 900000,
    foodAllowance: 1400000,
    childAllowance: 0,
    overtimeAmount: 500000,
    grossPay: 12800000,
    insuranceDeduction: 800000,
    incomeTax: 700000,
    otherDeductions: 0,
    absenceDeduction: 0,
    netPay: 11300000,
    employerInsurance: 1600000,
    unemploymentInsurance: 0,
    workDays: 30,
    status: PayslipStatus.ISSUED,
    journalEntryId: null,
    journalEntryNumber: null,
    issuedAt: "2026-11-05T10:00:00Z",
    createdAt: "2026-11-05T10:00:00Z",
    ...overrides,
  }) as Payslip;

test("formats gross, total deductions and net in Persian rials", () => {
  const data = mapPayslipToA5Data(fixture());
  // 10,000,000 + 900,000 + 1,400,000 + 500,000 = 12,800,000
  assert.equal(data.grossPay, "۱۲٬۸۰۰٬۰۰۰");
  // 0 + 800,000 + 700,000 + 0 = 1,500,000
  assert.equal(data.totalDeductions, "۱٬۵۰۰٬۰۰۰");
  assert.equal(data.netPay, "۱۱٬۳۰۰٬۰۰۰");
});

test("maps the identity, period and allowance fields as real values", () => {
  const data = mapPayslipToA5Data(fixture());
  assert.equal(data.monthName, "آبان");
  assert.equal(data.year, "۱۴۰۵");
  assert.equal(data.payslipNumber, "PS-1405-0001");
  assert.equal((data.employee as { fullName: string }).fullName, "علی رضایی");
  assert.equal((data.employee as { number: string }).number, "1042");
  assert.equal(data.workDays, "۳۰");
  assert.equal(data.baseSalary, "۱۰٬۰۰۰٬۰۰۰");
  assert.equal(data.housingAllowance, "۹۰۰٬۰۰۰");
  assert.equal(data.foodAllowance, "۱٬۴۰۰٬۰۰۰");
  assert.equal(data.insuranceDeduction, "۸۰۰٬۰۰۰");
  assert.equal(data.incomeTax, "۷۰۰٬۰۰۰");
  assert.equal(data.employerInsurance, "۱٬۶۰۰٬۰۰۰");
});

test("fields the payslip does not carry stay empty", () => {
  const data = mapPayslipToA5Data(fixture());
  assert.equal((data.employee as { nationalId: string }).nationalId, "");
  assert.equal((data.employee as { insuranceNumber: string }).insuranceNumber, "");
  assert.equal((data.employee as { jobTitle: string }).jobTitle, "");
  assert.equal((data.company as { name: string }).name, "");
});

test("fills every placeholder of the real template", () => {
  const html = renderTemplate(PAYSLIP_A5_TEMPLATE, mapPayslipToA5Data(fixture()));
  assert.equal(html.includes("{{"), false);
  assert.ok(html.includes("PS-1405-0001"));
  assert.ok(html.includes("آبان ۱۴۰۵"));
  assert.ok(html.includes("<style>"));
});

test("escapes user text through the renderer", () => {
  const html = renderTemplate(
    PAYSLIP_A5_TEMPLATE,
    mapPayslipToA5Data(fixture({ employeeFullName: "<b>x</b>" })),
  );
  assert.equal(html.includes("<b>x</b>"), false);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});
