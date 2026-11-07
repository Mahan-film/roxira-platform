import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import { integerToPersianWords } from "../persian-words.ts";
import { STATUS_LABELS, type Cheque, type ChequeDirection } from "../../types/cheques.ts";

/** The receipt's own title and the label of the counterparty, by cheque direction. */
const RECEIPT_TITLES: Record<ChequeDirection, string> = {
  received: "رسید دریافت چک",
  issued: "رسید پرداخت چک",
};

const PARTY_LABELS: Record<ChequeDirection, string> = {
  received: "دریافت از",
  issued: "پرداخت به",
};

/**
 * Data for print-templates/cheque-receipt-a5, one cheque per receipt. The cheque API carries no
 * receipt number, receipt date (only the cheque issueDate and dueDate), company name, party
 * national id (partyCode is a ledger code), «بابت», linked invoice, bank branch, account owner or
 * account number, so those stay empty and are filled by hand rather than guessed here.
 */
export function mapChequeToReceiptData(cheque: Cheque): Record<string, unknown> {
  const amount = Number(cheque.amount);
  return {
    directionLabel: RECEIPT_TITLES[cheque.direction],
    receiptNumber: "",
    dateJalali: "",
    partyLabel: PARTY_LABELS[cheque.direction],
    party: { name: cheque.partyName, nationalId: "" },
    purpose: "",
    invoiceRefs: "",
    chequeCount: formatNumber(1),
    total: formatNumber(amount),
    totalInWords: integerToPersianWords(BigInt(String(cheque.amount).split(".")[0])),
    currencyLabel: "ریال",
    company: { name: "" },
    isDraft: false,
    cheques: [
      {
        row: formatNumber(1),
        number: cheque.chequeNumber,
        sayadId: cheque.sayadNumber ?? "",
        bank: cheque.bankName ?? "",
        branch: "",
        owner: "",
        accountNumber: "",
        dueDateJalali: formatJalaliDate(cheque.dueDate),
        amount: formatNumber(amount),
        status: STATUS_LABELS[cheque.direction][cheque.status],
      },
    ],
  };
}
