/** Frozen copy, do not edit */
import { minorToDecimal } from '../money';

export function legacyMovementLines(
  kind: 'CHARGE' | 'RETURN',
  fundCode: string,
  counterCode: string,
  amountMinor: bigint,
): Array<{ accountCode: string; debit: string; credit: string }> {
  const dec = minorToDecimal(amountMinor);
  const [debitAccount, creditAccount] =
    kind === 'CHARGE' ? [fundCode, counterCode] : [counterCode, fundCode];
  return [
    { accountCode: debitAccount, debit: dec, credit: '0.00' },
    { accountCode: creditAccount, debit: '0.00', credit: dec },
  ];
}
