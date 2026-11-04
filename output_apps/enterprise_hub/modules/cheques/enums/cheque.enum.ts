/** Cheque direction relative to the tenant. */
export enum ChequeDirection {
  /** Received from a customer (asset: notes receivable). */
  RECEIVED = 'received',
  /** Issued by the tenant to a supplier (liability: notes payable). */
  ISSUED = 'issued',
}

/**
 * Lifecycle state. The same enum serves both directions; which transitions are
 * legal for which direction lives in `lifecycle/cheque-lifecycle.ts`.
 */
export enum ChequeStatus {
  /** Received and held by us, or issued and outstanding. */
  REGISTERED = 'registered',
  /** Issued cheque handed to the payee; the liability is unchanged, only the status moves (issued only). */
  DELIVERED = 'delivered',
  /** Received cheque handed to the bank for collection. */
  DEPOSITED = 'deposited',
  /** Paid by the bank. Terminal. */
  CLEARED = 'cleared',
  /** Refused by the bank. */
  BOUNCED = 'bounced',
  /** Given back to the drawer (received) or cancelled and taken back (issued). Terminal. */
  RETURNED = 'returned',
  /** Endorsed to a third party in settlement of a payable (received only). Terminal. */
  SPENT = 'spent',
}
