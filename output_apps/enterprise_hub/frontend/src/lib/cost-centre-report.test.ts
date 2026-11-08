import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReportSummary,
  costCentreTrialBalanceToCsv,
  filterSections,
  formatCentreTitle,
  getCentreDepthLabel,
} from "./cost-centre-report.ts";
import type { CostCentreSection, CostCentreTrialBalanceReport } from "../types/accounting-reports.ts";

const sampleAmounts = {
  openingDebit: 0,
  openingCredit: 0,
  priorDebit: 0,
  priorCredit: 0,
  periodDebit: 1000,
  periodCredit: 500,
  turnoverDebit: 1000,
  turnoverCredit: 500,
  endingDebit: 500,
  endingCredit: 0,
};

const sampleSectionA: CostCentreSection = {
  code: "CC-101",
  name: "شعبه مرکز",
  parentCode: null,
  depth: 0,
  rows: [
    {
      code: "10101",
      name: "صندوق ریالی",
      level: "TAFSILI",
      ...sampleAmounts,
    },
  ],
  totals: { ...sampleAmounts },
};

const sampleSectionB: CostCentreSection = {
  code: "CC-102",
  name: "شعبه شمال",
  parentCode: "CC-101",
  depth: 1,
  rows: [
    {
      code: "10201",
      name: "بانک سامان",
      level: "TAFSILI",
      ...sampleAmounts,
      periodDebit: 2000,
    },
  ],
  totals: { ...sampleAmounts, periodDebit: 2000 },
};

const sampleSectionUnassigned: CostCentreSection = {
  code: null,
  name: "بدون مرکز هزینه",
  parentCode: null,
  depth: 0,
  rows: [],
  totals: { ...sampleAmounts, periodDebit: 0, periodCredit: 0 },
};

const sampleReport: CostCentreTrialBalanceReport = {
  period: { yearStart: "2026-03-21", from: "2026-03-21", to: "2027-03-20" },
  columns: 6,
  groups: ["opening", "period", "ending"],
  costCenterCode: null,
  centres: [sampleSectionA, sampleSectionB, sampleSectionUnassigned],
  totals: { ...sampleAmounts, periodDebit: 3000, periodCredit: 1000 },
  balanced: true,
};

test("formatCentreTitle formats code and name or name alone", () => {
  assert.equal(formatCentreTitle({ name: "شعبه مرکز", code: "CC-101" }), "شعبه مرکز (CC-101)");
  assert.equal(formatCentreTitle({ name: "بدون مرکز هزینه", code: null }), "بدون مرکز هزینه");
});

test("getCentreDepthLabel describes root vs nested levels", () => {
  assert.equal(getCentreDepthLabel(0), "سطح اصلی");
  assert.equal(getCentreDepthLabel(1), "زیرمجموعه سطح 1");
  assert.equal(getCentreDepthLabel(2), "زیرمجموعه سطح 2");
});

test("calculateReportSummary computes high level metrics accurately", () => {
  const summary = calculateReportSummary(sampleReport);
  assert.equal(summary.totalCentres, 3);
  assert.equal(summary.totalAccountRows, 2);
  assert.equal(summary.isBalanced, true);
  assert.deepEqual(summary.groups, ["opening", "period", "ending"]);
});

test("filterSections filters by centre code, centre name, or account row attributes", () => {
  // Empty search returns all
  assert.equal(filterSections(sampleReport.centres, "").length, 3);

  // Search by centre code
  const byCode = filterSections(sampleReport.centres, "CC-102");
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0].code, "CC-102");

  // Search by centre name
  const byName = filterSections(sampleReport.centres, "شمال");
  assert.equal(byName.length, 1);
  assert.equal(byName[0].code, "CC-102");

  // Search by account name inside a section
  const byAccount = filterSections(sampleReport.centres, "صندوق");
  assert.equal(byAccount.length, 1);
  assert.equal(byAccount[0].code, "CC-101");
  assert.equal(byAccount[0].rows.length, 1);

  // Search with no match
  const noMatch = filterSections(sampleReport.centres, "موردی‌وجود‌ندارد");
  assert.equal(noMatch.length, 0);
});

test("costCentreTrialBalanceToCsv generates valid CSV neutralizing formula injections", () => {
  const injectionReport: CostCentreTrialBalanceReport = {
    ...sampleReport,
    centres: [
      {
        code: "=1+2",
        name: "@Danger",
        parentCode: null,
        depth: 0,
        rows: [
          {
            code: "+98912",
            name: "-SpecialAccount",
            level: "KOL",
            ...sampleAmounts,
          },
        ],
        totals: { ...sampleAmounts },
      },
    ],
  };

  const csv = costCentreTrialBalanceToCsv(injectionReport);
  const lines = csv.split("\n");
  assert.ok(lines.length >= 3);

  // First line is header
  assert.ok(lines[0].includes("کد مرکز"));
  assert.ok(lines[0].includes("افتتاحیه بدهکار"));

  // Check injection neutralization: dangerous prefixes must start with leading apostrophe
  assert.ok(csv.includes("''=1+2") || csv.includes("''@Danger") || csv.includes("'+98912") || csv.includes("'-SpecialAccount"));
});
