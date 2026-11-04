/** Receipt: money in from a customer. Payment: money out to a supplier. */
export enum TreasuryDocKind {
  RECEIPT = 'receipt',
  PAYMENT = 'payment',
}

export enum TreasuryPartyType {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
}

export enum TreasuryMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  /** Card / POS: the bank receives the money (minus the fee) later; see POS settlement (TRS-2). */
  CARD = 'card',
  CHEQUE = 'cheque',
}

export enum TreasuryDocStatus {
  POSTED = 'posted',
  REVERSED = 'reversed',
}

/** What an allocation settles. Only invoices exist today; kept as a column so more can follow. */
export enum AllocationTargetType {
  INVOICE = 'invoice',
}
