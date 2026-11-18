import { fromMinor } from '../money';

export const DEFAULT_WARN_AT_PERCENT = 80;
export const DEFAULT_BLOCK_AT_PERCENT = 100;

export type BudgetEncumbranceStatus = 'OK' | 'WARN' | 'BLOCK';

export interface BudgetEncumbranceInput {
  budgetMinor: bigint;
  actualSpendMinor: bigint;
  committedMinor: bigint;
  newAmountMinor: bigint;
  warnAtPercent?: number;
  blockAtPercent?: number;
}

export interface BudgetEncumbranceDecision {
  status: BudgetEncumbranceStatus;
  allowed: boolean;
  utilizationPercent: number;
  budgetMinor: bigint;
  actualSpendMinor: bigint;
  committedMinor: bigint;
  projectedMinor: bigint;
  remainingMinor: bigint;
  warning?: string;
}

/**
 * Pure bigint budget encumbrance check (T194).
 * Evaluates (actualSpend + openCommitments + newPO) against allocated budget:
 *   - > blockAtPercent (default 100%): BLOCK
 *   - >= warnAtPercent (default 80%): WARN (allowed)
 *   - < warnAtPercent: OK (allowed)
 */
export function evaluateBudgetEncumbrance(
  input: BudgetEncumbranceInput,
): BudgetEncumbranceDecision {
  const warnAtPercent = input.warnAtPercent ?? DEFAULT_WARN_AT_PERCENT;
  const blockAtPercent = input.blockAtPercent ?? DEFAULT_BLOCK_AT_PERCENT;
  const projectedMinor =
    input.actualSpendMinor + input.committedMinor + input.newAmountMinor;

  if (input.budgetMinor <= 0n) {
    return {
      status: 'OK',
      allowed: true,
      utilizationPercent: 0,
      budgetMinor: 0n,
      actualSpendMinor: input.actualSpendMinor,
      committedMinor: input.committedMinor,
      projectedMinor,
      remainingMinor: 0n,
    };
  }

  const remainingMinor = input.budgetMinor - projectedMinor;
  const utilizationPercent = Number((projectedMinor * 100n) / input.budgetMinor);
  const scaledProjected = projectedMinor * 100n;
  const blockThreshold = input.budgetMinor * BigInt(blockAtPercent);
  const warnThreshold = input.budgetMinor * BigInt(warnAtPercent);

  if (scaledProjected > blockThreshold) {
    return {
      status: 'BLOCK',
      allowed: false,
      utilizationPercent,
      budgetMinor: input.budgetMinor,
      actualSpendMinor: input.actualSpendMinor,
      committedMinor: input.committedMinor,
      projectedMinor,
      remainingMinor,
    };
  }

  if (scaledProjected >= warnThreshold) {
    return {
      status: 'WARN',
      allowed: true,
      utilizationPercent,
      budgetMinor: input.budgetMinor,
      actualSpendMinor: input.actualSpendMinor,
      committedMinor: input.committedMinor,
      projectedMinor,
      remainingMinor,
      warning: `هشدار بودجه: مصرف بودجه به ${utilizationPercent}% رسیده است (سقف: ${fromMinor(input.budgetMinor)}، باقیمانده: ${fromMinor(remainingMinor)}).`,
    };
  }

  return {
    status: 'OK',
    allowed: true,
    utilizationPercent,
    budgetMinor: input.budgetMinor,
    actualSpendMinor: input.actualSpendMinor,
    committedMinor: input.committedMinor,
    projectedMinor,
    remainingMinor,
  };
}
