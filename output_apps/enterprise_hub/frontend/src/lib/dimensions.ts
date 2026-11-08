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
export function getBalanceDisplay(balanceStr: string | number): BalanceDisplay {
  const num = typeof balanceStr === "number" ? balanceStr : parseFloat(balanceStr || "0");
  if (Number.isNaN(num) || num === 0) {
    return { status: "SETTLED", statusFa: "تسویه", amountMinor: BigInt(0) };
  }
  if (num > 0) {
    return { status: "DEBIT", statusFa: "بد", amountMinor: BigInt(Math.round(num)) };
  }
  return { status: "CREDIT", statusFa: "بس", amountMinor: BigInt(Math.round(Math.abs(num))) };
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
    const deb = parseFloat(r.debit || "0");
    const cred = parseFloat(r.credit || "0");
    if (!Number.isNaN(deb)) totalDebit += BigInt(Math.round(deb));
    if (!Number.isNaN(cred)) totalCredit += BigInt(Math.round(cred));
  }

  return {
    totalDebit,
    totalCredit,
    netBalance: totalDebit - totalCredit,
  };
}
