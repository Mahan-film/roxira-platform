import type { Dimension, DimensionBalanceRow } from "@/types/dimension";

const CODE_REGEX = /^[A-Za-z0-9._-]{1,32}$/;

/** Validates dimension code format: Latin letters, numbers, dot, underscore, dash, max 32 chars. */
export function isValidDimensionCode(code: string): boolean {
  return CODE_REGEX.test(code.trim());
}

export type BalanceStatus = "DEBIT" | "CREDIT" | "SETTLED";

export interface BalanceDisplay {
  status: BalanceStatus;
  statusFa: string;
  amountMinor: bigint;
}

/** Parses numeric balance string and returns debit/credit marker in Persian. */
function toMinorBigInt(raw: string | number | bigint | null | undefined): bigint {
  if (typeof raw === "bigint") return raw;
  const intPart = String(raw ?? "0").trim().split(".")[0];
  if (!intPart || intPart === "-" || intPart === "+") return BigInt(0);
  try { return BigInt(intPart); } catch { return BigInt(0); }
}

export function getBalanceDisplay(balanceStr: string | number): BalanceDisplay {
  const n = toMinorBigInt(balanceStr);
  const zero = BigInt(0);
  if (n === zero) return { status: "SETTLED", statusFa: "تسویه", amountMinor: zero };
  if (n > zero) return { status: "DEBIT", statusFa: "بد", amountMinor: n };
  return { status: "CREDIT", statusFa: "بس", amountMinor: -n };
}

export interface DimensionTreeNode {
  dimension: Dimension;
  children: DimensionTreeNode[];
}

/** Builds hierarchical tree of cost centres based on parentId. */
export function buildDimensionTree(dimensions: Dimension[]): DimensionTreeNode[] {
  const map = new Map<number, DimensionTreeNode>();
  const roots: DimensionTreeNode[] = [];

  for (const d of dimensions) {
    map.set(d.id, { dimension: d, children: [] });
  }

  for (const d of dimensions) {
    const node = map.get(d.id)!;
    if (d.parentId && map.has(d.parentId)) {
      map.get(d.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Calculates summary totals for a list of dimension balance rows. */
export function calculateBalancesSummary(rows: DimensionBalanceRow[]): {
  totalDebit: bigint;
  totalCredit: bigint;
  netBalance: bigint;
} {
  let totalDebit = BigInt(0);
  let totalCredit = BigInt(0);

  for (const r of rows) {
    totalDebit += toMinorBigInt(r.debit);
    totalCredit += toMinorBigInt(r.credit);
  }

  return {
    totalDebit,
    totalCredit,
    netBalance: totalDebit - totalCredit,
  };
}
