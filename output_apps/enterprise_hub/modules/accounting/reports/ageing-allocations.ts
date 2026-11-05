/**
 * Real settlements for ageing (#237): which invoice a receipt or payment paid, from treasury
 * allocations (TRS-01, #234). Pure, minor units.
 *
 * Ledger lines carry a `ref` (see `LedgerReportRepository.ageingLines`):
 *  - `inv:<invoiceId>`    the invoice's own posting (an open item);
 *  - `trs:<documentId>`   a treasury receipt or payment (a settlement);
 *  - `settle:<invoiceId>` the invoice's own paid or cancel posting (settles that invoice).
 * Lines without a ref (openings, manual vouchers) and any amount an allocation does not cover
 * still settle oldest-first (FIFO) in `ageing()`.
 */
import { toMinor } from '../money';
import { AgeingAllocation, AgeingAllocationSource } from './ageing';

/**
 * Nest token under which a module offers its allocations. TreasuryModule binds it to
 * TreasuryService; accounting looks it up lazily, so neither module imports the other.
 */
export const AGEING_ALLOCATIONS = 'AGEING_ALLOCATIONS';

/** The fields ageing needs from `TreasuryService.listAllocations` rows. */
export interface AllocationRow {
  documentId: number;
  invoiceId: string;
  amount: number | string;
  writeoff: number | string;
}

export interface AllocationLister {
  listAllocations(tenantId: string, query: { partyCode?: string; asOf?: string }): Promise<AllocationRow[]>;
}

export const invoiceRef = (invoiceId: string): string => `inv:${invoiceId}`;
export const treasuryRef = (documentId: number): string => `trs:${documentId}`;

/**
 * An allocation source over `rows`. A treasury document settles its invoices in allocation order
 * (amount plus write-off, which its voucher also credits to the party), shared across the
 * document's ledger lines so nothing is applied twice.
 */
export function allocationSource(rows: readonly AllocationRow[]): AgeingAllocationSource {
  const byDocument = new Map<string, AgeingAllocation[]>();
  for (const row of rows) {
    const key = treasuryRef(row.documentId);
    const list = byDocument.get(key) ?? [];
    list.push({ itemRef: invoiceRef(row.invoiceId), amount: toMinor(row.amount) + toMinor(row.writeoff) });
    byDocument.set(key, list);
  }
  return (settlement) => {
    let budget = settlement.debit - settlement.credit;
    budget = budget < 0n ? -budget : budget;
    const ref = settlement.ref ?? '';
    if (ref.startsWith('settle:')) {
      return [{ itemRef: invoiceRef(ref.slice('settle:'.length)), amount: budget }];
    }
    const out: AgeingAllocation[] = [];
    for (const left of byDocument.get(ref) ?? []) {
      if (budget === 0n) break;
      const used = left.amount < budget ? left.amount : budget;
      if (used > 0n) {
        out.push({ itemRef: left.itemRef, amount: used });
        left.amount -= used;
        budget -= used;
      }
    }
    return out;
  };
}
