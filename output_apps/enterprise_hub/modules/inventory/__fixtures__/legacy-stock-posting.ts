/* Frozen copy of StockDocumentsService.postValueEntry line building before the posting rules
 * engine (#380), kept only to prove the engine posts identical stock vouchers. Do not edit. */
import { minorToDecimal } from '../../accounting/money';

/** Amounts are decimal strings (legacy scale); the engine speaks integer minor units. */
export interface LegacyStockPostingLine {
  accountCode: string;
  debit?: string;
  credit?: string;
  description: string;
}

/** Frozen copy of the pre-#380 stock value voucher lines (net > 0 inventory debit, else reverse). */
export function legacyStockValueLines(
  accounts: string[],
  net: bigint,
): LegacyStockPostingLine[] {
  const [inventoryCode, counterCode] = accounts;
  const amount = minorToDecimal(net < 0n ? -net : net);
  const debitInventory = net > 0n;
  return debitInventory
    ? [
        { accountCode: inventoryCode, debit: amount, description: 'موجودی کالا' },
        { accountCode: counterCode, credit: amount, description: 'مابه‌ازای ثبت موجودی' },
      ]
    : [
        { accountCode: counterCode, debit: amount, description: 'کسری انبار' },
        { accountCode: inventoryCode, credit: amount, description: 'موجودی کالا' },
      ];
}

/** Frozen copy of the pre-#380 entry number. */
export function legacyStockEntryNumber(docNumber: string): string {
  return `STK-${docNumber}`;
}
