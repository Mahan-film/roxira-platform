/**
 * Pure functions for keyboard navigation and rapid entry in double-entry vouchers.
 * Tested offline with node --test.
 */

export interface LineAmounts {
  debit: string;
  credit: string;
}

export type NavigationDirection = "next" | "prev" | "down" | "up";

export interface CellCoord {
  row: number;
  col: number;
  shouldAddRow?: boolean;
}

/**
 * Calculates the balancing amount needed on `targetIndex` to make total debit == total credit.
 * When other debits exceed other credits, target row receives the difference as Credit.
 * When other credits exceed other debits, target row receives the difference as Debit.
 */
export function computeBalancingAmount(
  lines: LineAmounts[],
  targetIndex: number,
): LineAmounts {
  const zero = BigInt(0);
  const toBig = (s?: string) => {
    const d = (s ?? "").replace(/[^\d]/g, "");
    return d ? BigInt(d) : zero;
  };
  let otherDebit = zero;
  let otherCredit = zero;

  for (let i = 0; i < lines.length; i++) {
    if (i === targetIndex) continue;
    otherDebit += toBig(lines[i]?.debit);
    otherCredit += toBig(lines[i]?.credit);
  }

  const diff = otherDebit - otherCredit;
  if (diff > zero) return { debit: "", credit: diff.toString() };
  if (diff < zero) return { debit: (-diff).toString(), credit: "" };
  return { debit: "", credit: "" };
}

/**
 * Calculates next cell coordinates in the voucher grid:
 * Column 0: Account selection
 * Column 1: Debit input
 * Column 2: Credit input
 * Column 3: Description input
 *
 * Special ergonomic accounting rules:
 * - Entering a debit amount skips credit directly to description.
 * - Pressing Enter on the description of the final row signals that a new row should be appended.
 */
export function getNextCellCoordinates(
  currentRow: number,
  currentCol: number,
  totalRows: number,
  hasDebitValue: boolean,
  direction: NavigationDirection,
): CellCoord {
  if (totalRows <= 0) {
    return { row: 0, col: 0 };
  }

  const clampedRow = Math.max(0, Math.min(currentRow, totalRows - 1));

  switch (direction) {
    case "next": {
      if (currentCol === 0) {
        return { row: clampedRow, col: 1 };
      }
      if (currentCol === 1) {
        // If debit is populated, skip credit (double-entry lines are debit OR credit, not both)
        return { row: clampedRow, col: hasDebitValue ? 3 : 2 };
      }
      if (currentCol === 2) {
        return { row: clampedRow, col: 3 };
      }
      // Col 3: last column of row
      if (clampedRow === totalRows - 1) {
        return { row: totalRows, col: 0, shouldAddRow: true };
      }
      return { row: clampedRow + 1, col: 0 };
    }

    case "prev": {
      if (currentCol === 3) return { row: clampedRow, col: 2 };
      if (currentCol === 2) return { row: clampedRow, col: 1 };
      if (currentCol === 1) return { row: clampedRow, col: 0 };
      // Col 0: previous row
      if (clampedRow > 0) return { row: clampedRow - 1, col: 3 };
      return { row: 0, col: 0 };
    }

    case "down": {
      if (clampedRow < totalRows - 1) {
        return { row: clampedRow + 1, col: currentCol };
      }
      return { row: clampedRow, col: currentCol };
    }

    case "up": {
      if (clampedRow > 0) {
        return { row: clampedRow - 1, col: currentCol };
      }
      return { row: 0, col: currentCol };
    }
  }
}

/** Check if event matches the accountant Save shortcut (Ctrl+S / Cmd+S or Ctrl+Enter) */
export function isSaveShortcut(e: { ctrlKey?: boolean; metaKey?: boolean; key: string }): boolean {
  return Boolean((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S" || e.key === "Enter"));
}

/** Check if event matches F2 (Account Search) */
export function isAccountSearchKey(e: { key: string }): boolean {
  return e.key === "F2";
}

/** Check if event matches Insert (New Line) */
export function isInsertLineKey(e: { key: string }): boolean {
  return e.key === "Insert";
}

/** Check if event matches Esc (Cancel) */
export function isCancelKey(e: { key: string }): boolean {
  return e.key === "Escape";
}
