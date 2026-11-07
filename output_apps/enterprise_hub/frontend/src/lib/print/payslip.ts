import { formatNumber } from "../fa-format.ts";
import type { Payslip } from "../../types/hr.ts";

const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const money = (value?: number): string => formatNumber(value ?? 0);

/**
 * Data for print-templates/payslip-a5. The API carries no company name, employee national id,
 * insurance number or job title on a payslip, so those stay empty and are filled by hand rather
 * than guessed here. totalDeductions is the sum of the four deduction rows because the payslip
 * does not expose a total column (see the template header comment).
 */
export function mapPayslipToA5Data(payslip: Payslip): Record<string, unknown> {
  const totalDeductions =
    (payslip.absenceDeduction ?? 0) +
    payslip.insuranceDeduction +
    payslip.incomeTax +
    (payslip.otherDeductions ?? 0);

  return {
    monthName: JALALI_MONTHS[payslip.periodMonth - 1] ?? "",
    year: formatNumber(payslip.periodYear).replace(/٬/g, ""),
    company: { name: "" },
    employee: {
      fullName: payslip.employeeFullName,
      number: payslip.employeeNumber,
      nationalId: "",
      insuranceNumber: "",
      jobTitle: "",
    },
    workDays: money(payslip.workDays),
    payslipNumber: payslip.payslipNumber,
    baseSalary: money(payslip.baseSalary),
    seniorityAmount: money(payslip.seniorityAmount),
    housingAllowance: money(payslip.housingAllowance),
    foodAllowance: money(payslip.foodAllowance),
    childAllowance: money(payslip.childAllowance),
    marriageAllowance: money(payslip.marriageAllowance),
    allowancesTotal: money(payslip.allowancesTotal),
    overtimeAmount: money(payslip.overtimeAmount),
    nightShiftAmount: money(payslip.nightShiftAmount),
    holidayAmount: money(payslip.holidayAmount),
    eidiAmount: money(payslip.eidiAmount),
    grossPay: money(payslip.grossPay),
    absenceDeduction: money(payslip.absenceDeduction),
    insuranceDeduction: money(payslip.insuranceDeduction),
    incomeTax: money(payslip.incomeTax),
    otherDeductions: money(payslip.otherDeductions),
    totalDeductions: formatNumber(totalDeductions),
    netPay: money(payslip.netPay),
    employerInsurance: money(payslip.employerInsurance),
    unemploymentInsurance: money(payslip.unemploymentInsurance),
  };
}
