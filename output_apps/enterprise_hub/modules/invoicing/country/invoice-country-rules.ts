import { EInvoiceType } from '../enums/invoice-kind.enum';

/** What a buyer must have on record for one e-invoice type. */
export type BuyerIdentityLevel = 'none' | 'name' | 'tax_id';

/**
 * Per-country invoicing rules. The core never mentions a country: it asks the rule of the
 * tenant's country. A country without an entry gets the neutral rule (no buyer identity needed,
 * anonymous sales allowed). Add a country by adding an entry here.
 */
export interface InvoiceCountryRule {
  countryCode: string;
  /** Type used when the sale names no identified buyer. */
  anonymousType: EInvoiceType;
  /** Buyer identity the type needs before the invoice may be issued. */
  identityNeeded(type: EInvoiceType): BuyerIdentityLevel;
}

const NEUTRAL: InvoiceCountryRule = {
  countryCode: '*',
  anonymousType: EInvoiceType.WITHOUT_BUYER,
  identityNeeded: () => 'none',
};

/**
 * Iran: type 1 (with buyer) needs the buyer's name and national or economic code; type 2
 * (without buyer) and 3 (retail) need nothing, and type 2 is the consumer default.
 */
const IRAN: InvoiceCountryRule = {
  countryCode: 'IR',
  anonymousType: EInvoiceType.WITHOUT_BUYER,
  identityNeeded: (type) => (type === EInvoiceType.WITH_BUYER ? 'tax_id' : 'none'),
};

const RULES = new Map<string, InvoiceCountryRule>([[IRAN.countryCode, IRAN]]);

export function invoiceRuleFor(countryCode: string | null | undefined): InvoiceCountryRule {
  return RULES.get((countryCode ?? '').toUpperCase()) ?? NEUTRAL;
}
