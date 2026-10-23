/** Iranian banks whose statement exports the import pipeline recognises (see constants). */
export enum BankCode {
  MELLAT = 'mellat',
  MELLI = 'melli',
  SADERAT = 'saderat',
  TEJARAT = 'tejarat',
  PASARGAD = 'pasargad',
  SAMAN = 'saman',
  OTHER = 'other',
}

/** How a statement line got matched to a ledger line. */
export enum MatchMethod {
  /** Auto-match by amount + date window (+ reference number when present). */
  AUTO = 'auto',
  /** Picked by a user. */
  MANUAL = 'manual',
  /** A journal entry was created from the unmatched statement line. */
  CREATED = 'created',
}

/** Filter for statement lines. */
export enum StatementLineStatus {
  MATCHED = 'matched',
  UNMATCHED = 'unmatched',
}
