import type { InvoiceResponseDto } from "@/types/invoicing";

export interface PosDayEndSummary {
  date: string;
  invoiceCount: number;
  cashTotal: bigint;
  cardTotal: bigint;
  transferTotal: bigint;
  otherTotal: bigint;
  grandTotal: bigint;
  invoices: InvoiceResponseDto[];
}

function toBigIntMinor(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value.trim());
  }
  return 0n;
}

export function summarizePosDayEnd(
  invoices: InvoiceResponseDto[],
  targetDate: string,
): PosDayEndSummary {
  const matching = invoices.filter((inv) => {
    const issueDate = inv.issueDate ?? "";
    return issueDate.slice(0, 10) === targetDate;
  });

  let cashTotal = 0n;
  let cardTotal = 0n;
  let transferTotal = 0n;
  let otherTotal = 0n;
  let grandTotal = 0n;

  for (const inv of matching) {
    const amount = toBigIntMinor(inv.totalAmount);
    grandTotal += amount;
    const method = (inv as { paymentMethod?: string }).paymentMethod;
    if (method === "cash") {
      cashTotal += amount;
    } else if (method === "card") {
      cardTotal += amount;
    } else if (method === "transfer") {
      transferTotal += amount;
    } else {
      otherTotal += amount;
    }
  }

  return {
    date: targetDate,
    invoiceCount: matching.length,
    cashTotal,
    cardTotal,
    transferTotal,
    otherTotal,
    grandTotal,
    invoices: matching,
  };
}

export function computeCashDiff(expectedCash: bigint, countedCash: bigint): bigint {
  return countedCash - expectedCash;
}
