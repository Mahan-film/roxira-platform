export type TreasuryDocKind = "receipt" | "payment";
export type TreasuryMethod = "cash" | "bank_transfer" | "card" | "cheque";

export const TREASURY_METHOD_LABELS: Record<TreasuryMethod, string> = {
  cash: "نقد (صندوق)",
  bank_transfer: "واریز بانکی / حواله",
  card: "کارتخوان / پوز",
  cheque: "چک",
};

export const TREASURY_KIND_LABELS: Record<TreasuryDocKind, string> = {
  receipt: "رسید دریافت",
  payment: "رسید پرداخت",
};

export interface SettlementMethodItem {
  amount: number | string;
}

export interface SettlementAllocationItem {
  amount: number | string;
  writeoff?: number | string;
}

export interface SettlementTotals {
  totalMethods: number;
  totalAllocated: number;
  totalWriteoff: number;
  advanceAmount: number;
}

/**
 * Computes payment methods total, invoice allocations total, writeoff total, and residual advance.
 */
export function computeSettlementTotals(
  methods: SettlementMethodItem[],
  allocations: SettlementAllocationItem[],
): SettlementTotals {
  const totalMethods = methods.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const totalAllocated = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const totalWriteoff = allocations.reduce((sum, a) => sum + (Number(a.writeoff) || 0), 0);
  const advanceAmount = Math.max(0, totalMethods - totalAllocated);

  return {
    totalMethods,
    totalAllocated,
    totalWriteoff,
    advanceAmount,
  };
}

/**
 * Validates whether a treasury settlement form has all minimum required data.
 */
export function validateSettlementSubmission(data: {
  partyCode?: string;
  docDate?: string;
  totalMethods: number;
}): string | null {
  if (!data.partyCode || data.partyCode.trim().length === 0) {
    return "کد طرف‌حساب الزامی است.";
  }
  if (!data.docDate || data.docDate.trim().length === 0) {
    return "تاریخ سند الزامی است.";
  }
  if (data.totalMethods <= 0) {
    return "مبلغ روش‌های پرداخت باید بیشتر از صفر باشد.";
  }
  return null;
}

export function getTreasuryMethodLabel(method: TreasuryMethod): string {
  return TREASURY_METHOD_LABELS[method] || method;
}

export function getTreasuryKindLabel(kind: TreasuryDocKind): string {
  return TREASURY_KIND_LABELS[kind] || kind;
}
