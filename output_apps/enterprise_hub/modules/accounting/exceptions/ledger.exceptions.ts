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

/** A line names a dimension code that does not exist or is inactive for this tenant. */
export class UnknownDimensionError extends Error {
  constructor(readonly kind: string, readonly code: string) {
    super(`Unknown or inactive ${kind} ${code}.`);
  }
}
