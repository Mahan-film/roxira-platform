import { AccountType } from '../../accounting/enums/accounting.enum';
import { findTemplate } from '../../posting_rules/domain/posting-templates';

/** A ledger account the stock documents book to; found by name, then code, else created. */
export interface StockAccountSpec {
  code: string;
  name: string;
  accountType: AccountType;
  match: string[];
  /** Name fragments that rule an account out. */
  exclude?: string[];
}

const openingDefaults = () => findTemplate('stock.opening')?.defaults ?? {};
const adjustmentDefaults = () => findTemplate('stock.adjustment_gain')?.defaults ?? {};
const issueDefaults = () => findTemplate('stock.issue')?.defaults ?? {};
const receiptDefaults = () => findTemplate('stock.receipt')?.defaults ?? {};

export const STOCK_INVENTORY_ACCOUNT: StockAccountSpec = {
  get code() {
    return openingDefaults().inventory ?? '1301';
  },
  name: 'موجودی کالا',
  accountType: AccountType.ASSET,
  match: ['موجودی کالا', 'موجودی انبار'],
};

/** Counterpart of an opening stock receipt: equity, not income. */
export const OPENING_STOCK_EQUITY_ACCOUNT: StockAccountSpec = {
  get code() {
    return openingDefaults().opening_equity ?? '3030';
  },
  name: 'موجودی اول دوره کالا',
  accountType: AccountType.EQUITY,
  match: ['اول دوره', 'افتتاحیه'],
};

/** Stocktake gains and losses. */
export const STOCK_ADJUSTMENT_ACCOUNT: StockAccountSpec = {
  get code() {
    return adjustmentDefaults().stock_adjustment ?? '5301';
  },
  name: 'کسری و اضافات انبار',
  accountType: AccountType.EXPENSE,
  match: ['کسری', 'اضافات'],
};

export const STOCK_ISSUE_ACCOUNT: StockAccountSpec = {
  get code() {
    return issueDefaults().cogs ?? '5101';
  },
  name: 'بهای تمام‌شده کالای فروش‌رفته / مصرف',
  accountType: AccountType.EXPENSE,
  match: ['بهای تمام‌شده', 'مصرف'],
};

export const STOCK_RECEIPT_ACCOUNT: StockAccountSpec = {
  get code() {
    return receiptDefaults().purchases ?? '5201';
  },
  name: 'خرید کالا و خدمات',
  accountType: AccountType.EXPENSE,
  match: ['خرید کالا', 'خرید'],
};
