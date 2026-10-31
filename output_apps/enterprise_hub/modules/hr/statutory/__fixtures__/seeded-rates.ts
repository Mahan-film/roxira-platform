import {
  seedEffectiveFrom,
  seedSource,
  STATUTORY_SEEDS,
} from '../../../../migrations/data/statutory-seed';
import { PayrollYearRates } from '../payroll-rates';
import { StatutoryKey } from '../statutory-catalogue';
import {
  StatutoryParameterEntity,
  StatutorySourceKind,
} from '../statutory-parameter.entity';
import { resolveParameters, StatutoryService, toPayrollRates } from '../statutory.service';

/** The migration's seed as entity rows, so unit tests run on exactly what production gets. */
export function seededRows(year: number): StatutoryParameterEntity[] {
  return STATUTORY_SEEDS.filter(([fiscalYear]) => fiscalYear === year).map(
    (seed, index) => {
      const [fiscalYear, paramKey, value, kind] = seed;
      return {
        id: String(index + 1),
        tenantId: null,
        country: 'IR',
        fiscalYear,
        paramKey,
        effectiveFrom: seedEffectiveFrom(fiscalYear),
        version: 1,
        value,
        source: seedSource(seed),
        sourceKind: kind as StatutorySourceKind,
        verified: kind === 'OFFICIAL',
        createdBy: 'migration',
        createdAt: new Date(0),
      };
    },
  );
}

export const seededRates = (year: number): PayrollYearRates =>
  toPayrollRates(
    year,
    resolveParameters(seededRows(year), '9999-12-31') as Map<
      StatutoryKey,
      StatutoryParameterEntity
    >,
  );

/** StatutoryService stand-in backed by the seed. */
export const fakeStatutory = (): StatutoryService =>
  ({
    hasYear: async (_tenantId: string, year: number) =>
      seededRows(year).length > 0,
    ratesFor: async (_tenantId: string, year: number) => seededRates(year),
    ratesForLatestUpTo: async (_tenantId: string, year?: number) =>
      seededRates(year !== undefined && year < 1405 ? 1404 : 1405),
  }) as unknown as StatutoryService;
