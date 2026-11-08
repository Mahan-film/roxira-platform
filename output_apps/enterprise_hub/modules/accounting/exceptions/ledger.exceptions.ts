import { HttpException } from '@nestjs/common';

/** 423 Locked: the posting date falls inside a locked accounting period. */
export class PeriodLockedException extends HttpException {
  constructor(message: string) {
    super(
      { statusCode: 423, error: 'PeriodLocked', message },
      423,
    );
  }
}

/** Repository-level signals the service maps to HTTP errors (no HTTP types in persistence). */
export class LockedPeriodError extends Error {
  constructor(readonly date: string) {
    super(`Date ${date} is inside a locked period.`);
  }
}

export class DuplicateEntryNumberError extends Error {
  constructor(readonly entryNumber: string) {
    super(`Entry number ${entryNumber} already exists.`);
  }
}

/**
 * The (tenant, idempotency key) already belongs to a voucher. Thrown from the inserting
 * transaction BEFORE the insert, so the final-number trigger never runs and no number is burned.
 */
export class IdempotentReplayError extends Error {
  constructor(readonly existing: unknown) {
    super('Idempotency key already used.');
  }
}

/** A line names a dimension code that does not exist or is inactive for this tenant. */
export class UnknownDimensionError extends Error {
  constructor(readonly kind: string, readonly code: string) {
    super(`Unknown or inactive ${kind} ${code}.`);
  }
}

/**
 * An optimistic-lock UPDATE matched zero rows because the voucher's `version` moved after the
 * caller read it. The service turns this into 409 with a refresh message.
 */
export class VoucherVersionConflictError extends Error {
  constructor(readonly entryId: number) {
    super(`Voucher ${entryId} was changed by another user.`);
  }
}
