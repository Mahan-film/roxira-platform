/**
 * The one place the purchase cycle turns its events into journal lines (#227 T2).
 *
 * Events speak in account ROLES, never codes. `PURCHASE_ACCOUNT_ROLES` maps a role to an account
 * spec, resolved the same way invoice posting resolves its accounts (name match, then code).
 * When `modules/posting_rules` (#230, #231) lands, only `resolvePurchaseRole` changes.
 */
import { AccountType } from '../../accounting/enums/accounting.enum';
import { findTemplate } from '../../posting_rules/domain/posting-templates';
import {
  COGS_ACCOUNT,
  INVENTORY_ACCOUNT,
  InvoiceAccountSpec,
  PAYABLE_ACCOUNT,
  VAT_RECEIVABLE_ACCOUNT,
} from '../../invoicing/constants/suite-events.constants';

export enum PurchaseAccountRole {
  INVENTORY = 'INVENTORY',
  /** Goods received, not yet invoiced (clearing between receipt and supplier invoice). */
  GRNI = 'GRNI',
  PAYABLE = 'PAYABLE',
  VAT_RECEIVABLE = 'VAT_RECEIVABLE',
  PRICE_VARIANCE = 'PRICE_VARIANCE',
  LANDED_COST_CLEARING = 'LANDED_COST_CLEARING',
  COGS = 'COGS',
}

const receiptDefaults = () => findTemplate('purchase.receipt')?.defaults ?? {};
const invoiceDefaults = () => findTemplate('purchase.invoice')?.defaults ?? {};
const landedDefaults = () => findTemplate('purchase.landed_cost')?.defaults ?? {};

const PURCHASE_ACCOUNT_ROLES: Record<PurchaseAccountRole, InvoiceAccountSpec> = {
  [PurchaseAccountRole.INVENTORY]: INVENTORY_ACCOUNT,
  [PurchaseAccountRole.PAYABLE]: PAYABLE_ACCOUNT,
  [PurchaseAccountRole.VAT_RECEIVABLE]: VAT_RECEIVABLE_ACCOUNT,
  [PurchaseAccountRole.COGS]: COGS_ACCOUNT,
  [PurchaseAccountRole.GRNI]: {
    get code() {
      return receiptDefaults().grni ?? '2013';
    },
    name: 'کالای دریافتی صورتحساب‌نشده',
    accountType: AccountType.LIABILITY,
    match: ['صورتحساب‌نشده'],
  },
  [PurchaseAccountRole.PRICE_VARIANCE]: {
    get code() {
      return invoiceDefaults().price_variance ?? '5120';
    },
    name: 'تفاوت بهای خرید',
    accountType: AccountType.EXPENSE,
    match: ['تفاوت بهای خرید'],
  },
  [PurchaseAccountRole.LANDED_COST_CLEARING]: {
    get code() {
      return landedDefaults().payable ?? '2014';
    },
    name: 'هزینه‌های حمل و گمرک پرداختنی',
    accountType: AccountType.LIABILITY,
    match: ['حمل و گمرک'],
  },
};

/** Account spec for a role. The single switch point to posting_rules. */
export function resolvePurchaseRole(role: PurchaseAccountRole): InvoiceAccountSpec {
  return PURCHASE_ACCOUNT_ROLES[role];
}

export interface RolePostingLine {
  role: PurchaseAccountRole;
  /** Minor units; exactly one of debit / credit is positive. */
  debit: bigint;
  credit: bigint;
  partyCode?: string;
  description: string;
}

export interface PurchasePosting {
  sourceType: 'GOODS_RECEIPT';
  sourceId: string;
  date: Date;
  description: string;
  lines: RolePostingLine[];
}

export type PurchasePostingEvent = {
  kind: 'GOODS_RECEIPT';
  receiptId: string;
  receiptNumber: string;
  orderNumber: string;
  supplierCode: string;
  receivedAt: Date;
  /** Receipt value at PO price, minor units. */
  value: bigint;
};

/** Journal lines of a purchase event, by role. Returns null when there is nothing to post. */
export function purchasePostingLines(event: PurchasePostingEvent): PurchasePosting | null {
  if (event.value <= 0n) {
    return null;
  }
  const description = `رسید کالا ${event.receiptNumber} (سفارش ${event.orderNumber})`;
  return {
    sourceType: 'GOODS_RECEIPT',
    sourceId: event.receiptId,
    date: event.receivedAt,
    description,
    lines: [
      { role: PurchaseAccountRole.INVENTORY, debit: event.value, credit: 0n, description },
      {
        role: PurchaseAccountRole.GRNI,
        debit: 0n,
        credit: event.value,
        partyCode: event.supplierCode,
        description,
      },
    ],
  };
}
