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
        unclear: false,
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

const sanavatRow = (
  tenantId: string | null,
  fiscalYear: number,
  paramKey: string,
  value: number,
  effectiveFrom: string,
  version = 1,
): StatutoryParameterEntity => ({
  id: `${tenantId}-${paramKey}-${effectiveFrom}-${version}`,
  tenantId,
  country: 'IR',
  fiscalYear,
  paramKey,
  effectiveFrom,
  version,
  value,
  unclear: false,
  source: 'test',
  sourceKind: StatutorySourceKind.REPORT,
  verified: false,
  createdBy: 'migration',
  createdAt: new Date(0),
});

/** Mirrors migration 1789480000000 (the pg spec checks the two agree). */
export const SANAVAT_ROWS: StatutoryParameterEntity[] = [
  sanavatRow(null, 1404, 'sanavat_days_per_year', 30, '2025-03-21'),
  sanavatRow(null, 1404, 'sanavat_year_days', 365, '2025-03-21'),
  sanavatRow(null, 1405, 'sanavat_days_per_year', 30, '2026-03-21'),
  sanavatRow(null, 1405, 'sanavat_year_days', 365, '2026-03-21'),
  sanavatRow(null, 1404, 'payroll_month_days', 30, '2025-03-21'),
  sanavatRow(null, 1405, 'payroll_month_days', 30, '2026-03-21'),
];

/** Tenant overrides for tests, keyed by tenant id. */
export const TENANT_ROWS: Record<string, StatutoryParameterEntity[]> = {};

/** StatutoryService stand-in backed by the seed. */
export const fakeStatutory = (): StatutoryService =>
  ({
    hasYear: async (_tenantId: string, year: number) =>
      seededRows(year).length > 0,
    ratesFor: async (_tenantId: string, year: number) => seededRates(year),
    settlementTermsOn: async (tenantId: string, asOf: string) =>
      new StatutoryService(
        {
          findKeysUpToYear: async (
            tenant: string,
            _country: string,
            keys: string[],
            maxYear: number,
          ) =>
            [...SANAVAT_ROWS, ...(TENANT_ROWS[tenant] ?? [])].filter(
              (row) => keys.includes(row.paramKey) && row.fiscalYear <= maxYear,
            ),
        } as never,
        {} as never,
      ).settlementTermsOn(tenantId, asOf),
    ratesForLatestUpTo: async (_tenantId: string, year?: number) =>
      seededRates(year !== undefined && year < 1405 ? 1404 : 1405),
  }) as unknown as StatutoryService;
