/** How an invoice packet reaches the tax authority for one fiscal memory (docs/tax/TAX_TRANSMISSION_DESIGN.md). */
export enum TaxTransmissionMode {
  /** We sign with the taxpayer's own key and call Moadian ourselves. */
  DIRECT = 'direct',
  /** A TSP sends the packet; it is signed with the taxpayer's key (we hold it). */
  TSP_TAXPAYER_KEY = 'tsp_taxpayer_key',
  /** A TSP sends and signs with the TSP's own key. */
  TSP_TSP_KEY = 'tsp_tsp_key',
}

export enum TaxTransmissionEnvironment {
  SANDBOX = 'sandbox',
  PRODUCTION = 'production',
}
