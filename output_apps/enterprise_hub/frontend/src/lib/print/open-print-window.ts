import { ACCOUNTING_VOUCHER_A4_TEMPLATE } from "../../print-templates/accounting-voucher-a4.template.ts";
import type { JournalEntryResponse } from "../../types/accounting.ts";

import { mapJournalEntryToVoucherData } from "./accounting-voucher.ts";
import { renderTemplate } from "./render-template.ts";

/** Opens the voucher in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printVoucher(entry: JournalEntryResponse, statusLabel: string): void {
  const html = renderTemplate(ACCOUNTING_VOUCHER_A4_TEMPLATE, mapJournalEntryToVoucherData(entry, statusLabel));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
