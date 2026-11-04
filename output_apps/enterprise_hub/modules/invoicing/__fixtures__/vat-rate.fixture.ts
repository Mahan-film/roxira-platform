import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { VatRateResolver } from '../services/vat-rate.resolver';

/**
 * Test fixture only. Production code reads the general VAT rate by invoice date from the
 * statutory store (`vat_general_rate`, see services/vat-rate.resolver.ts); never import this
 * from non-spec code.
 */
export const DEFAULT_VAT_RATE = 0.1;

/** A resolver with no statutory store whose tenant setting is `rate` (specs that do not test VAT). */
export const fixtureVatRates = (rate = DEFAULT_VAT_RATE): VatRateResolver =>
  new VatRateResolver(undefined, {
    findDefaultVatRate: async () => rate,
  } as unknown as TenantsRepository);
