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
  let otherDebit = 0;
  let otherCredit = 0;

  for (let i = 0; i < lines.length; i++) {
    if (i === targetIndex) continue;
    const d = Number(lines[i]?.debit) || 0;
    const c = Number(lines[i]?.credit) || 0;
    otherDebit += d;
    otherCredit += c;
  }

  const diff = Math.round(otherDebit - otherCredit);

  if (diff > 0) {
    // Debit is heavier; target needs credit to balance
    return { debit: "", credit: String(diff) };
  } else if (diff < 0) {
    // Credit is heavier; target needs debit to balance
    return { debit: String(Math.abs(diff)), credit: "" };
  }

  // Already balanced
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
