import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("hr-client defines payslip PDF download helpers for PAY-02", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/api/hr-client.ts"),
    "utf8",
  );
  assert.match(src, /export async function downloadPayrollRunPayslipsPdf/);
  assert.match(src, /\/payroll-runs\/\$\{runId\}\/payslips-pdf/);
  assert.match(src, /export async function downloadPayslipPdf/);
  assert.match(src, /\/payroll-runs\/\$\{runId\}\/payslips\/\$\{payslipId\}\/pdf/);
});

test("payroll page wires PDF download buttons for run and individual payslip", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/app/app/hr/payroll/page.tsx"),
    "utf8",
  );
  assert.match(src, /downloadPayrollRunPayslipsPdf\(run\.id\)/);
  assert.match(src, /downloadPayslipPdf\(run\.id,\s*p\.id\)/);
  assert.match(src, /downloadPayslipPdf\(runId,\s*payslip\.id\)/);
});
