/**
 * Pure helpers for the invoice list (#301, docs/design/DESIGN_AUDIT_2026-11.md §8): who the party
 * is, what is still owed, and the selection total. Type-only imports, so `node --test` runs it.
 */
import type { InvoiceResponseDto } from "../types/invoicing.ts";

type PartyFields = Pick<InvoiceResponseDto, "direction" | "customerId" | "buyerInfo" | "sellerInfo">;

/** A list row with its amount already in rials (a foreign invoice converted at its own rate). */
export interface RialRow {
  id: string;
  status: InvoiceResponseDto["status"];
  rialAmount: number;
}

export interface InvoiceParty {
  /** The party's real name, or null when the invoice has none (never a made-up label). */
  name: string | null;
  /** National id or economic code, shown when there is no name so the row is still identifiable. */
  hint: string | null;
  /** Link to the party record, when the invoice is tied to one. */
  href: string | null;
}

/** The other side of the invoice: the buyer on a sale, the seller on a purchase. */
export function invoiceParty(invoice: PartyFields): InvoiceParty {
  const sale = String(invoice.direction) !== "PURCHASE";
  const info = sale ? invoice.buyerInfo : invoice.sellerInfo;
  const name = info?.name?.trim() || null;
  const hint = name ? null : info?.nationalId?.trim() || info?.economicCode?.trim() || null;
  const href = sale && invoice.customerId != null ? `/app/crm?lead=${invoice.customerId}` : null;
  return { name, hint, href };
}

/**
 * What is still owed, in rials: the whole amount while the invoice is issued, zero once paid,
 * null for drafts and cancelled invoices.
 */
export function invoiceOutstanding(row: Pick<RialRow, "status" | "rialAmount">): number | null {
  switch (String(row.status)) {
    case "ISSUED":
      return row.rialAmount;
    case "PAID":
      return 0;
    default:
      return null;
  }
}

/** How many rows are selected and the sum of their rial amounts. */
export function selectionTotal(
  rows: readonly RialRow[],
  selected: ReadonlySet<string>,
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    count += 1;
    total += row.rialAmount;
  }
  return { count, total };
}

/** Toggles one id, or every visible id when `id` is null. Returns a new set. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
  id: string | null,
): Set<string> {
  const next = new Set(selected);
  if (id === null) {
    const all = visibleIds.length > 0 && visibleIds.every((visible) => next.has(visible));
    for (const visible of visibleIds) {
      if (all) next.delete(visible);
      else next.add(visible);
    }
    return next;
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
