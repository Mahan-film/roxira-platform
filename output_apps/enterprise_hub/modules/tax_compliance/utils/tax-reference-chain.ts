import { MoadianInvoiceSubject, MoadianSubmissionStatus } from '../enums/moadian.enum';
import type { InvoiceItem } from '../../invoicing/entities/invoice.entity';

export interface ChainRow {
  invoiceId: string;
  ins: number;
  status: MoadianSubmissionStatus;
  taxId: string;
  activeReferenceTaxId: string | null;
}

export class TaxChainBlockedError extends Error {
  constructor(
    readonly code: 'ROOT_NOT_CONFIRMED' | 'REFERENCE_NOT_FINAL' | 'CHAIN_CANCELLED',
    message: string,
  ) {
    super(message);
  }
}

const NOT_FINAL = new Set<MoadianSubmissionStatus>([
  MoadianSubmissionStatus.QUEUED,
  MoadianSubmissionStatus.SENT,
  MoadianSubmissionStatus.UNKNOWN,
]);

/**
 * The irtaxid for the next amendment/return/cancellation of a root invoice: the latest CONFIRMED taxid.
 * `chain` holds every submission of the root (the root row included). Blocks while any of them is
 * pending/unknown, while the root itself is not confirmed, and after a confirmed cancellation.
 */
export function resolveChainReference(root: ChainRow | null, chain: ChainRow[]): string {
  if (!root || root.status !== MoadianSubmissionStatus.SUCCESS) {
    throw new TaxChainBlockedError(
      'ROOT_NOT_CONFIRMED',
      'The main invoice is not confirmed by the tax authority yet.',
    );
  }
  if (
    chain.some(
      (r) => r.ins === MoadianInvoiceSubject.CANCELLATION && r.status === MoadianSubmissionStatus.SUCCESS,
    )
  ) {
    throw new TaxChainBlockedError('CHAIN_CANCELLED', 'The invoice is already cancelled.');
  }
  if (chain.some((r) => NOT_FINAL.has(r.status))) {
    throw new TaxChainBlockedError(
      'REFERENCE_NOT_FINAL',
      'An earlier submission of this invoice is still pending or unknown; wait until it is final.',
    );
  }
  return root.activeReferenceTaxId ?? root.taxId;
}

const EPS = 1e-9;

/**
 * True when one return gives back every quantity of every original line (then it is sent as a
 * cancellation, ins=3). Lines are matched by `originalLine` (index into the original items); a
 * return line without it matches nothing. Partial earlier returns are not netted: only a single
 * return that covers 100% of the original converts.
 */
export function isFullReturn(original: InvoiceItem[], returned: InvoiceItem[]): boolean {
  if (original.length === 0) return false;
  const given = new Map<number, number>();
  for (const line of returned) {
    if (typeof line.originalLine !== 'number') continue;
    given.set(line.originalLine, (given.get(line.originalLine) ?? 0) + Number(line.quantity));
  }
  return original.every((line, index) => (given.get(index) ?? 0) >= Number(line.quantity) - EPS);
}
