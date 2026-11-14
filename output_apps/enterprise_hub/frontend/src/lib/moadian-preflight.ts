/**
 * Pre-flight result shapes returned by `POST moadian/invoices/:id/pre-flight`.
 *
 * The validation itself (checksums, VAT rate, line math, header totals) lives ONLY in the backend
 * (`modules/tax_compliance/utils/moadian-preflight.validator.ts`, which shares the line math with
 * InvoicingService). The UI shows the server result and never re-implements it, so the two cannot
 * drift. If a draft form ever needs validation before an invoice exists, expose a backend endpoint
 * for it instead of copying the math here.
 */
export interface MoadianPreFlightError {
  field: string;
  message: string;
  code: string;
}

export interface MoadianPreFlightResult {
  valid: boolean;
  errors: MoadianPreFlightError[];
}
