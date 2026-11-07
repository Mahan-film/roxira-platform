/**
 * Pure helpers for the customer drawer tabs (#302, docs/design/DESIGN_AUDIT_2026-11.md §9):
 * «فاکتورها · دریافت‌ها · مانده · چک‌ها». A customer is a CRM lead; invoices carry it as `customerId`.
 * Type-only imports for the data shapes, so `node --test` runs this without the Next alias.
 */
import type { Cheque } from "../types/cheques.ts";
import type { Lead } from "../types/crm.ts";
import { InvoiceDirection, InvoiceStatus, type InvoiceResponseDto } from "../types/invoicing.ts";

export type PartyTab = "invoices" | "receipts" | "balance" | "cheques";

export const PARTY_TAB_ORDER: PartyTab[] = ["invoices", "receipts", "balance", "cheques"];

export const PARTY_TAB_LABELS: Record<PartyTab, string> = {
  invoices: "فاکتورها",
  receipts: "دریافت‌ها",
  balance: "مانده",
  cheques: "چک‌ها",
};

/** Sale invoices of this customer, newest first. */
export function partySaleInvoices(
  invoices: readonly InvoiceResponseDto[],
  leadId: number,
): InvoiceResponseDto[] {
  return invoices
    .filter((i) => i.customerId === leadId && i.direction === InvoiceDirection.SALE)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Receipts: sale invoices already marked paid, by payment date (newest first). */
export function partyReceipts(saleInvoices: readonly InvoiceResponseDto[]): InvoiceResponseDto[] {
  return saleInvoices
    .filter((i) => i.status === InvoiceStatus.PAID)
    .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
}

/**
 * Balance owed by the customer: the total of issued sale invoices not yet paid.
 * This is an invoice-based figure, not the ledger balance of the party account.
 * Integer rials, summed as numbers (the API sends rials as integers).
 */
export function partyOpenBalance(saleInvoices: readonly InvoiceResponseDto[]): {
  total: number;
  count: number;
} {
  const open = saleInvoices.filter((i) => i.status === InvoiceStatus.ISSUED);
  return { total: open.reduce((sum, i) => sum + i.finalPayable, 0), count: open.length };
}

/**
 * Received cheques whose party name is this customer's person or company name.
 * Cheques carry no customer id, so this is a name match: trimmed, exact.
 */
export function partyReceivedCheques(
  cheques: readonly Cheque[],
  lead: Pick<Lead, "fullName" | "company">,
): Cheque[] {
  const names = [lead.fullName, lead.company ?? ""].map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return [];
  return cheques.filter(
    (c) => c.direction === "received" && names.includes((c.partyName ?? "").trim()),
  );
}
