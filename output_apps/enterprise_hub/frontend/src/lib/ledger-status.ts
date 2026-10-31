/**
 * Status of the ledger as shown on the accounting overview.
 *
 * "unknown" is the state before the trial balance has loaded (or when loading
 * failed): it must never be rendered as "unbalanced", because nothing is known.
 * "empty" means the ledger loaded and has no postings yet.
 */
export type LedgerStatus = "unknown" | "empty" | "balanced" | "unbalanced";

export interface LedgerTotals {
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export function ledgerStatus(trialBalance: LedgerTotals | null | undefined): LedgerStatus {
  if (!trialBalance) return "unknown";
  if (trialBalance.totalDebit === 0 && trialBalance.totalCredit === 0) return "empty";
  return trialBalance.balanced ? "balanced" : "unbalanced";
}

export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  unknown: "در حال دریافت",
  empty: "بدون گردش",
  balanced: "تراز",
  unbalanced: "ناتراز",
};
