import { AccountType } from '../../accounting/enums/accounting.enum';

/** A ledger account the stock documents book to; found by name, then code, else created. */
export interface StockAccountSpec {
  code: string;
  name: string;
  accountType: AccountType;
  match: string[];
  /** Name fragments that rule an account out. */
  exclude?: string[];
}

export const STOCK_INVENTORY_ACCOUNT: StockAccountSpec = {
  code: '1301',
  name: 'موجودی کالا',
  accountType: AccountType.ASSET,
  match: ['موجودی کالا', 'موجودی انبار'],
};

/** Counterpart of an opening stock receipt: equity, not income. */
export const OPENING_STOCK_EQUITY_ACCOUNT: StockAccountSpec = {
  code: '3030',
  name: 'موجودی اول دوره کالا',
  accountType: AccountType.EQUITY,
  match: ['اول دوره', 'افتتاحیه'],
};

/** Stocktake gains and losses. */
export const STOCK_ADJUSTMENT_ACCOUNT: StockAccountSpec = {
  code: '5301',
  name: 'کسری و اضافات انبار',
  accountType: AccountType.EXPENSE,
  match: ['کسری', 'اضافات'],
};
