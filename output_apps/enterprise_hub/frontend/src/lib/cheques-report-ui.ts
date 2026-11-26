import { formatMoneyRial, type MoneyUnit } from "./fa-format.ts";
import { minorToMajorString } from "./petty-cash-ui.ts";
import { toMinorUnits } from "./cheques-ui.ts";
import type {
  BankChequeMaturity,
  Cheque,
  ChequeDirection,
  ChequeStatus,
} from "../types/cheques.ts";

const ZERO = BigInt(0);

/**
 * Converts a backend minor-unit string (hundredths of a rial) to an exact rial decimal string.
 */
export function minorStringToRial(minorStr: string | null | undefined): string {
  if (minorStr === null || minorStr === undefined) return "0";
  const trimmed = minorStr.trim();
  if (!/^-?\d+$/.test(trimmed)) return "0";
  return minorToMajorString(BigInt(trimmed));
}

/**
 * Formats a backend minor-unit string (hundredths of a rial) via `formatMoneyRial`.
 */
export function formatChequeMinorRial(
  minorStr: string | null | undefined,
  unit: MoneyUnit = "rial",
): string {
  return formatMoneyRial(minorStringToRial(minorStr), unit);
}

export interface ChequePortfolioFilter {
  direction?: ChequeDirection | "all";
  status?: ChequeStatus | "all";
  bankName?: string;
  search?: string;
}

/**
 * Filters a cheque register list by direction, status, bank name, and free-text query
 * (party name, cheque number, or Sayad number).
 */
export function filterPortfolioCheques(
  cheques: ReadonlyArray<Cheque>,
  filter: ChequePortfolioFilter,
): Cheque[] {
  const dir = filter.direction ?? "all";
  const st = filter.status ?? "all";
  const bank = filter.bankName?.trim() ?? "";
  const q = filter.search?.trim().toLowerCase() ?? "";

  return cheques.filter((c) => {
    if (dir !== "all" && c.direction !== dir) return false;
    if (st !== "all" && c.status !== st) return false;
    if (bank) {
      const chequeBank = (c.bankName ?? "").trim() || "سایر / نامشخص";
      if (chequeBank !== bank) return false;
    }
    if (q) {
      const haystack = [
        c.partyName,
        c.partyCode ?? "",
        c.chequeNumber,
        c.sayadNumber ?? "",
        c.bankName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export interface ChequeStatusSummary {
  status: ChequeStatus;
  count: number;
  totalRial: string;
}

/**
 * Groups filtered cheques by status with exact BigInt rial totals.
 */
export function summarizeByStatus(
  cheques: ReadonlyArray<Pick<Cheque, "status" | "remainingAmount" | "amount">>,
): ChequeStatusSummary[] {
  const map = new Map<ChequeStatus, { count: number; minor: bigint }>();
  for (const c of cheques) {
    const entry = map.get(c.status) ?? { count: 0, minor: ZERO };
    entry.count += 1;
    const raw = toMinorUnits(c.remainingAmount ?? c.amount) ?? ZERO;
    entry.minor += raw;
    map.set(c.status, entry);
  }
  return Array.from(map.entries()).map(([status, entry]) => ({
    status,
    count: entry.count,
    totalRial: minorToMajorString(entry.minor),
  }));
}

/**
 * Collects unique sorted bank names from both register rows and maturity-report bank buckets.
 */
export function collectBankNames(
  cheques: ReadonlyArray<Pick<Cheque, "bankName">>,
  byBank: ReadonlyArray<Pick<BankChequeMaturity, "bankName">> = [],
): string[] {
  const set = new Set<string>();
  for (const b of byBank) {
    const name = b.bankName.trim();
    if (name) set.add(name);
  }
  for (const c of cheques) {
    const name = (c.bankName ?? "").trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fa"));
}

/**
 * Neutralizes spreadsheet formula prefixes (`=`, `+`, `-`, `@`) for safe CSV export.
 */
export function csvSafeCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
