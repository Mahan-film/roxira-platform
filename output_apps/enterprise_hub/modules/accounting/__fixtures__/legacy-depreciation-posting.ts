/* Frozen copy of the monthly depreciation posting before the posting rules engine (#230), kept only
 * to prove the engine posts the same lines. Do not edit. The old code posted one entry for all
 * assets of a month: expense debit and accumulated credit per asset, in asset order. */
import { minorToDecimal } from '../money';

export interface LegacyDepreciationItem {
  expenseAccountCode: string;
  accumulatedAccountCode: string;
  charge: bigint;
}

export function legacyDepreciationLines(items: LegacyDepreciationItem[]) {
  return items.flatMap(({ expenseAccountCode, accumulatedAccountCode, charge }) => [
    { accountCode: expenseAccountCode, debit: minorToDecimal(charge), credit: '0.00' },
    { accountCode: accumulatedAccountCode, debit: '0.00', credit: minorToDecimal(charge) },
  ]);
}
