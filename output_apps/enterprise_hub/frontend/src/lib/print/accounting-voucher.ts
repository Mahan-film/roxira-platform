import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import type { JournalEntryResponse } from "../../types/accounting.ts";

const amount = (value: number): string => (value ? formatNumber(value) : "");

/**
 * Data for print-templates/accounting-voucher-a4. The API has no company name, fiscal year, reference
 * number, voucher type, attachments, preparer or amount in words on a journal entry, so those stay
 * empty and are filled by hand on paper rather than guessed here.
 */
export function mapJournalEntryToVoucherData(entry: JournalEntryResponse, statusLabel: string): Record<string, unknown> {
  return {
    voucherNumber: entry.entryNumber,
    sequenceNumber: entry.permanentNumber ?? "",
    dateJalali: formatJalaliDate(entry.date),
    voucherType: "",
    status: statusLabel,
    fiscalYear: "",
    description: entry.description,
    company: { name: "" },
    lines: entry.lines.map((line, index) => ({
      row: formatNumber(index + 1),
      accountCode: line.accountCode,
      accountName: line.accountName,
      description: line.description ?? "",
      detail: "",
      debit: amount(line.debit),
      credit: amount(line.credit),
    })),
    totals: { debit: formatNumber(entry.totalDebit), credit: formatNumber(entry.totalCredit), inWords: "" },
    references: "",
    preparedBy: "",
    currencyLabel: entry.currency === "IRR" ? "ریال" : entry.currency,
    page: formatNumber(1),
    pages: formatNumber(1),
    isDraft: entry.status === "DRAFT",
  };
}
