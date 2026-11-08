import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import { integerToPersianWords } from "../persian-words.ts";
import {
  TREASURY_KIND_LABELS,
  TREASURY_METHOD_LABELS,
  TREASURY_PARTY_LABELS,
  type TreasuryDocumentDetail,
  type TreasuryLine,
} from "../../types/treasury.ts";

export interface PrintPaymentRow {
  method: string;
  detail: string;
  amount: string;
}

/** Builds a readable Persian string describing the instrument / account / reference. */
export function formatMethodDetail(line: TreasuryLine): string {
  const parts: string[] = [];
  if (line.reference) {
    parts.push(`پیگیری: ${line.reference}`);
  }
  if (line.bankName || line.bankAccountId) {
    parts.push(`بانک: ${line.bankName ?? line.bankAccountId}`);
  }
  if (line.accountNumber) {
    parts.push(`حساب: ${line.accountNumber}`);
  }
  if (line.chequeNumber) {
    parts.push(`شماره چک: ${line.chequeNumber}`);
  }
  if (line.dueDate) {
    parts.push(`سررسید: ${formatJalaliDate(line.dueDate)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "—";
}

/**
 * Maps a backend TreasuryDocumentDetail to the data object expected by
 * `RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE`.
 */
export function mapTreasuryDocToPrintData(
  doc: TreasuryDocumentDetail,
  companyName = "",
): Record<string, unknown> {
  const numericTotal = Number(doc.total);
  const totalBigInt = BigInt(String(doc.total).split(".")[0] || "0");
  const invoiceRefs = (doc.allocations ?? [])
    .map((a) => a.invoiceNumber ?? a.invoiceId)
    .filter(Boolean)
    .join("، ");

  const payments: PrintPaymentRow[] = (doc.methods ?? []).map((m) => {
    const numAmount = Number(m.amount);
    return {
      method: TREASURY_METHOD_LABELS[m.method] ?? m.method,
      detail: formatMethodDetail(m),
      amount: formatNumber(numAmount),
    };
  });

  const isReceipt = doc.kind === "receipt";

  return {
    docTitle: TREASURY_KIND_LABELS[doc.kind] ?? (isReceipt ? "رسید دریافت" : "رسید پرداخت"),
    documentNumber: doc.docNumber,
    dateJalali: formatJalaliDate(doc.docDate),
    isDraft: doc.status === "draft",
    company: { name: companyName },
    partyLabel: TREASURY_PARTY_LABELS[doc.kind] ?? (isReceipt ? "دریافت از" : "پرداخت به"),
    party: {
      name: doc.partyName,
      code: doc.partyCode,
    },
    amount: formatNumber(numericTotal),
    currencyLabel: "ریال",
    amountInWords: integerToPersianWords(totalBigInt),
    purpose: doc.description || (isReceipt ? "تسویه حساب و دریافت وجه" : "تسویه حساب و پرداخت وجه"),
    invoiceRefs,
    voucherNumber: doc.journalEntryId ? String(doc.journalEntryId) : "",
    payments,
    paymentsTotal: formatNumber(numericTotal),
    signerLeftLabel: isReceipt ? "تحویل‌گیرنده وجه" : "دریافت‌کننده وجه",
    signerRightLabel: isReceipt ? "صندوق‌دار / مسئول مالی" : "تنظیم‌کننده",
  };
}
