/**
 * What the party does for the tenant. BOTH is one row acting as customer and supplier at once,
 * so a customer filter must always include BOTH (see PartiesRepository.list).
 */
export enum PartyRole {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
  BOTH = 'both',
}
