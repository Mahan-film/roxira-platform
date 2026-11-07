/** How often a recurring voucher repeats, in Jalali calendar months. */
export enum RecurringVoucherFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

/** Jalali months a frequency advances on every run. */
export const FREQUENCY_MONTHS: Record<RecurringVoucherFrequency, number> = {
  [RecurringVoucherFrequency.MONTHLY]: 1,
  [RecurringVoucherFrequency.QUARTERLY]: 3,
  [RecurringVoucherFrequency.YEARLY]: 12,
};

/** BullMQ queue and job names for the daily run-due trigger. */
export const RECURRING_VOUCHERS_QUEUE = 'recurring-vouchers';
export const RECURRING_VOUCHER_RUN_JOB = 'recurring-vouchers-run-due';
