import { RoleAccounts } from '../../posting_rules/domain/posting-engine';

/** Stock value vouchers: opening balances, stocktake adjustments, issues and receipts. */
export type StockValueKind = 'opening' | 'adjustment' | 'issue' | 'receipt';

/** The engine doc type of a stock value voucher; `net === 0n` is never posted (callers guard). */
export function stockPostingDocType(kind: StockValueKind, net: bigint): string {
  if (kind === 'opening') {
    return 'stock.opening';
  }
  if (kind === 'issue') {
    return 'stock.issue';
  }
  if (kind === 'receipt') {
    return 'stock.receipt';
  }
  return net > 0n ? 'stock.adjustment_gain' : 'stock.adjustment_loss';
}

/**
 * Role accounts for a stock value voucher from the resolved account codes.
 * `accounts` is `[inventoryCode, counterCode]` exactly as `resolveAccounts` returns it.
 */
export function stockPostingOverrides(
  kind: StockValueKind,
  accounts: string[],
): RoleAccounts {
  const [inventory, counter] = accounts;
  if (kind === 'opening') {
    return { inventory, opening_equity: counter };
  }
  if (kind === 'issue') {
    return { inventory, cogs: counter };
  }
  if (kind === 'receipt') {
    return { inventory, purchases: counter };
  }
  return { inventory, stock_adjustment: counter };
}

/** The posting source type every stock document voucher is keyed by. */
export const STOCK_SOURCE_TYPE = 'stock_document';
