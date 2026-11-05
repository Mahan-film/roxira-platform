import { StatutorySourceKind } from '../../hr/statutory/statutory-parameter.entity';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { VatRateResolver } from '../services/vat-rate.resolver';

/**
 * Test fixture only. Production code reads the general VAT rate by invoice date from the
 * statutory store (`vat_general_rate`, see services/vat-rate.resolver.ts); never import this
 * from non-spec code.
 */
export const DEFAULT_VAT_RATE = 0.1;

/**
 * A resolver over an in-memory statutory store holding one platform `vat_general_rate` row of
 * `rate` for every fiscal year (specs that do not test VAT itself).
 */
export const fixtureVatRates = (rate = DEFAULT_VAT_RATE): VatRateResolver =>
  new VatRateResolver({
    findForYear: async (_tenantId: string, country: string, fiscalYear: number) => [
      {
        id: `fixture-vat-${fiscalYear}`,
        tenantId: null,
        country,
        fiscalYear,
        paramKey: 'vat_general_rate',
        effectiveFrom: '1900-01-01',
        version: 1,
        value: String(rate),
        source: 'test fixture',
        sourceKind: StatutorySourceKind.REPORT,
        verified: false,
        createdBy: 'test',
        createdAt: new Date(0),
      },
    ],
  } as unknown as StatutoryRepository);
