/* Frozen copy of the corporate-tax provision voucher lines before the posting rules engine (#230), kept only to prove the engine proposes identical lines for explicit account codes. Do not edit. */
import { minorToDecimal } from '../../accounting/money';

export interface LegacyVoucherLine {
  accountCode: string | null;
  debit: string;
  credit: string;
  description: string;
}

/** What `corporate-tax.service.ts` built inline before it called `PostingRulesService.propose`. */
export function legacyVoucherLines(provision: bigint, expenseAccountCode?: string, payableAccountCode?: string): LegacyVoucherLine[] {
  return provision > 0n
    ? [
        { accountCode: expenseAccountCode ?? null, debit: minorToDecimal(provision), credit: '0.00', description: 'هزینه مالیات بر درآمد' },
        { accountCode: payableAccountCode ?? null, debit: '0.00', credit: minorToDecimal(provision), description: 'مالیات بر درآمد پرداختنی' },
      ]
    : [];
}
