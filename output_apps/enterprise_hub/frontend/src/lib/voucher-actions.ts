/**
 * Pure functions determining allowed lifecycle actions for journal entries (vouchers).
 * Aligns with NestJS AccountingService state rules.
 */

export interface VoucherActionCapabilities {
  canDraft: boolean;
  canTemporary: boolean;
  canPost: boolean;
  canReverse: boolean;
  canEdit: boolean;
  canCopy: boolean;
}

/** A temporary voucher can be moved back to draft for further changes. */
export function canChangeToDraft(status: string): boolean {
  return status === "TEMPORARY";
}

/** A draft voucher can be marked temporary once lines are balanced and reviewed. */
export function canChangeToTemporary(status: string): boolean {
  return status === "DRAFT";
}

/** Non-final vouchers (DRAFT or TEMPORARY) can be posted to the general ledger. */
export function canPostVoucher(status: string): boolean {
  return status === "DRAFT" || status === "TEMPORARY";
}

/** Only final, posted vouchers can be reversed through an offset journal entry. */
export function canReverseVoucher(status: string): boolean {
  return status === "POSTED";
}

/** Only drafts and temporary vouchers can be edited; posted vouchers must be reversed. */
export function canEditVoucher(status: string): boolean {
  return status === "DRAFT" || status === "TEMPORARY";
}

/** Any non-void voucher can be cloned into a new draft. */
export function canCopyVoucher(status: string): boolean {
  return status !== "VOID";
}

/** Returns the map of permitted actions for a given voucher status. */
export function getVoucherAvailableActions(status: string): VoucherActionCapabilities {
  return {
    canDraft: canChangeToDraft(status),
    canTemporary: canChangeToTemporary(status),
    canPost: canPostVoucher(status),
    canReverse: canReverseVoucher(status),
    canEdit: canEditVoucher(status),
    canCopy: canCopyVoucher(status),
  };
}

/** Formats standard Persian description for a reversal voucher. */
export function formatReversalDescription(entryNumber: string, reason?: string): string {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return `برگشت سند شماره ${entryNumber}`;
  }
  return `برگشت سند شماره ${entryNumber} — ${trimmed}`;
}
