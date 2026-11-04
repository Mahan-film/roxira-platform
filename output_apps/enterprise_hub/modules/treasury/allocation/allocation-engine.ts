/**
 * Settlement of a receipt or payment against invoices (pure, integer minor units, no I/O).
 *
 * One document pays several invoices; one invoice is paid by several documents (each document
 * contributes allocation rows, the open amount is the invoice payable minus every earlier row).
 * Money not allocated stays on the document as an advance and can be allocated later with the same
 * rules. A small difference may be written off, but only when it closes the invoice and is not
 * above the tenant tolerance.
 */

export type AllocationErrorCode =
  | 'NEGATIVE_AMOUNT'
  | 'EMPTY_ROW'
  | 'DUPLICATE_TARGET'
  | 'UNKNOWN_TARGET'
  | 'OVER_OUTSTANDING'
  | 'WRITEOFF_NOT_CLOSING'
  | 'WRITEOFF_ABOVE_TOLERANCE'
  | 'OVER_AVAILABLE';

export class AllocationError extends Error {
  constructor(
    readonly code: AllocationErrorCode,
    message: string,
    readonly targetId?: string,
  ) {
    super(message);
  }
}

export interface OpenItem {
  targetId: string;
  /** Payable minus every active allocation (cash and write-off) of other documents. */
  outstanding: bigint;
}

export interface AllocationRequest {
  targetId: string;
  /** Money applied to the invoice. */
  amount: bigint;
  /** Small difference forgiven on the invoice. */
  writeoff: bigint;
}

export interface AllocationPlan {
  rows: AllocationRequest[];
  /** Sum of `amount`. */
  applied: bigint;
  /** Sum of `writeoff`. */
  writeoffTotal: bigint;
  /** `available - applied`: stays on the document as an advance. */
  advance: bigint;
}

export interface PlanInput {
  /** Money to distribute: the document total, or the advance still unallocated. */
  available: bigint;
  items: readonly OpenItem[];
  requests: readonly AllocationRequest[];
  /** Tenant write-off tolerance per invoice; 0 forbids write-offs. */
  tolerance: bigint;
}

export function planAllocation(input: PlanInput): AllocationPlan {
  const open = new Map(input.items.map((item) => [item.targetId, item.outstanding]));
  const seen = new Set<string>();
  let applied = 0n;
  let writeoffTotal = 0n;

  for (const row of input.requests) {
    if (row.amount < 0n || row.writeoff < 0n) {
      throw new AllocationError('NEGATIVE_AMOUNT', 'مبلغ تخصیص نمی‌تواند منفی باشد.', row.targetId);
    }
    if (row.amount + row.writeoff === 0n) {
      throw new AllocationError('EMPTY_ROW', 'ردیف تخصیص باید مبلغ یا تخفیف داشته باشد.', row.targetId);
    }
    if (seen.has(row.targetId)) {
      throw new AllocationError('DUPLICATE_TARGET', 'یک صورتحساب فقط یک‌بار در هر سند تخصیص می‌گیرد.', row.targetId);
    }
    seen.add(row.targetId);

    const outstanding = open.get(row.targetId);
    if (outstanding === undefined) {
      throw new AllocationError('UNKNOWN_TARGET', 'صورتحساب برای تخصیص یافت نشد.', row.targetId);
    }
    const settled = row.amount + row.writeoff;
    if (settled > outstanding) {
      throw new AllocationError('OVER_OUTSTANDING', 'مبلغ تخصیص از مانده صورتحساب بیشتر است.', row.targetId);
    }
    if (row.writeoff > 0n) {
      if (settled !== outstanding) {
        throw new AllocationError(
          'WRITEOFF_NOT_CLOSING',
          'تخفیف فقط برای بستن کامل صورتحساب مجاز است.',
          row.targetId,
        );
      }
      if (row.writeoff > input.tolerance) {
        throw new AllocationError('WRITEOFF_ABOVE_TOLERANCE', 'تخفیف از حد مجاز سازمان بیشتر است.', row.targetId);
      }
    }
    applied += row.amount;
    writeoffTotal += row.writeoff;
  }

  if (applied > input.available) {
    throw new AllocationError('OVER_AVAILABLE', 'جمع تخصیص‌ها از مبلغ سند بیشتر است.');
  }
  return { rows: input.requests.map((r) => ({ ...r })), applied, writeoffTotal, advance: input.available - applied };
}

/**
 * Oldest-first suggestion for the allocation grid: `items` must already be ordered (oldest first).
 * Fills each invoice up to its outstanding amount until the money runs out; the rest is an advance.
 */
export function suggestFifo(available: bigint, items: readonly OpenItem[]): AllocationRequest[] {
  const rows: AllocationRequest[] = [];
  let left = available;
  for (const item of items) {
    if (left <= 0n) break;
    if (item.outstanding <= 0n) continue;
    const take = left < item.outstanding ? left : item.outstanding;
    rows.push({ targetId: item.targetId, amount: take, writeoff: 0n });
    left -= take;
  }
  return rows;
}
