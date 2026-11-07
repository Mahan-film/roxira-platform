import { PAYSLIP_A5_TEMPLATE } from "../../print-templates/payslip-a5.template.ts";
import type { Payslip } from "../../types/hr.ts";

import { mapPayslipToA5Data } from "./payslip.ts";
import { renderTemplate } from "./render-template.ts";

/** Opens the payslip in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printPayslip(payslip: Payslip): void {
  const html = renderTemplate(PAYSLIP_A5_TEMPLATE, mapPayslipToA5Data(payslip));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
