import { PostingRole } from '../../posting_rules/constants/posting-roles';
import { RoleAccounts } from '../../posting_rules/domain/posting-engine';

/**
 * Pure helpers that turn the signed debit values the invoice posting service always worked with
 * (a negative debit is a credit) into the `<key>Dr` / `<key>Cr` amounts of the `invoice.*` posting
 * templates (posting_rules/domain/posting-templates.ts, #378). The engine refuses negative amounts,
 * so each row carries both sides and the unused side is 0.
 */
export type SignedRows = Readonly<Record<string, bigint>>;

export function drCrAmounts(rows: SignedRows): Record<string, bigint> {
  const amounts: Record<string, bigint> = {};
  for (const [key, value] of Object.entries(rows)) {
    amounts[`${key}Dr`] = value > 0n ? value : 0n;
    amounts[`${key}Cr`] = value < 0n ? -value : 0n;
  }
  return amounts;
}

export interface DocumentAmounts {
  receivable: bigint;
  vat: bigint;
  net: bigint;
  stock: bigint;
}

/** Rows of the issue (or, with `reverse`, the cancel) voucher: exactly the old `documentLines`. */
export function documentRows(sale: boolean, amounts: DocumentAmounts, reverse: boolean): SignedRows {
  const sign = reverse ? -1n : 1n;
  const rows: Record<string, bigint> = sale
    ? {
        receivable: amounts.receivable,
        sales: -amounts.net,
        vat: -amounts.vat,
        stock: amounts.stock,
        cogs: -amounts.stock,
      }
    : {
        stock: amounts.stock,
        purchases: amounts.net - amounts.stock,
        vat: amounts.vat,
        payable: -amounts.receivable,
      };
  return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value * sign]));
}

export function documentDocType(sale: boolean, reverse: boolean): string {
  return `invoice.${sale ? 'sale' : 'purchase'}.${reverse ? 'cancel' : 'issue'}`;
}

/**
 * Rows of the settlement voucher. Routes each payment method to its own clearing account
 * (card, DuitNow QR, eWallets, marketplaces) and cash/bank, with same-method parts merged into one line.
 * The party row settles the whole amount owed.
 */
export function settleRows(sale: boolean, parts: ReadonlyArray<readonly [string, bigint]>, owed: bigint): SignedRows {
  const sign = sale ? 1n : -1n;
  const rows = {
    cash: 0n,
    card: 0n,
    duitnow: 0n,
    ewallet: 0n,
    shopee: 0n,
    tiktok: 0n,
    grabfood: 0n,
  };
  for (const [rawMethod, amount] of parts) {
    const method = (rawMethod ?? '').trim().toUpperCase();
    if (method === 'CARD' || method === 'POS' || method === 'VISA' || method === 'MASTERCARD') {
      rows.card += sign * amount;
    } else if (method === 'DUITNOW' || method === 'DUITNOW_QR' || method === 'QR') {
      rows.duitnow += sign * amount;
    } else if (method === 'EWALLET' || method === 'TNG' || method === 'GRABPAY' || method === 'BOOST') {
      rows.ewallet += sign * amount;
    } else if (method === 'SHOPEE' || method === 'SHOPEEPAY') {
      rows.shopee += sign * amount;
    } else if (method === 'TIKTOK' || method === 'TIKTOK_SHOP') {
      rows.tiktok += sign * amount;
    } else if (method === 'GRABFOOD' || method === 'GRAB') {
      rows.grabfood += sign * amount;
    } else {
      rows.cash += sign * amount;
    }
  }
  return { ...rows, party: -sign * owed };
}

/** The settle template whose line order follows the first payment (cash-first unless it is a card). */
export function settleDocType(sale: boolean, parts: ReadonlyArray<readonly [string, bigint]>): string {
  const firstMethod = (parts[0]?.[0] ?? '').trim().toUpperCase();
  const cardFirst = firstMethod === 'CARD' || firstMethod === 'POS';
  return `invoice.${sale ? 'sale' : 'purchase'}.settle${cardFirst ? '_card_first' : ''}`;
}

/**
 * Tenant mappings made on the posting-rules settings page win over the account the invoicing
 * service resolved the legacy way (name match, else the 1201/4101/... default). `described` is the
 * `PostingRulesService.describe` entry of the document type whose mapping applies.
 */
export function mergeRoleAccounts(
  legacy: RoleAccounts,
  described: { roles: ReadonlyArray<{ role: string; accountCode: string | null; source: string }> } | undefined,
): RoleAccounts {
  const merged: Partial<Record<PostingRole, string>> = { ...legacy };
  for (const entry of described?.roles ?? []) {
    if (entry.source !== 'default' && entry.accountCode) merged[entry.role as PostingRole] = entry.accountCode;
  }
  return merged;
}
