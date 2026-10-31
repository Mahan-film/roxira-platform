import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../../access/services/audit.service';
import { seededRates, seededRows } from './__fixtures__/seeded-rates';
import { isValidStatutoryValue } from './statutory-catalogue';
import {
  StatutoryParameterEntity,
  StatutorySourceKind,
} from './statutory-parameter.entity';
import { StatutoryRepository } from './statutory.repository';
import { resolveParameters, StatutoryService, toPayrollRates } from './statutory.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

const row = (over: Partial<StatutoryParameterEntity>): StatutoryParameterEntity => ({
  ...seededRows(1405)[0],
  ...over,
});

describe('seed 1405', () => {
  const byKey = new Map(seededRows(1405).map((r) => [r.paramKey, r]));

  it('marks only circular 6682 figures as official and verified', () => {
    const verified = [...byKey.values()].filter((r) => r.verified).map((r) => r.paramKey).sort();
    expect(verified).toEqual([
      'food_allowance',
      'marriage_allowance',
      'min_daily_wage',
      'other_levels_daily_addition',
      'other_levels_percent',
      'seniority_daily',
    ]);
    expect(byKey.get('min_daily_wage')?.value).toBe(5_541_850);
    expect(byKey.get('seniority_daily')?.value).toBe(166_667);
    expect(byKey.get('other_levels_daily_addition')?.value).toBe(519_549);
    expect(byKey.get('marriage_allowance')?.value).toBe(5_000_000);
  });

  it('keeps tax, VAT, housing and insurance unverified', () => {
    for (const key of [
      'wage_tax_annual_brackets',
      'vat_general_rate',
      'housing_allowance',
      'employee_insurance_rate',
    ]) {
      expect(byKey.get(key)?.verified).toBe(false);
    }
    expect(seededRates(1405).unverifiedKeys).toContain('vat_general_rate');
  });

  it('every seeded value has the shape its key requires', () => {
    for (const r of [...seededRows(1404), ...seededRows(1405)]) {
      expect(isValidStatutoryValue(r.paramKey as never, r.value)).toBe(true);
    }
  });
});

describe('resolveParameters', () => {
  it('picks the latest effective date not after the period', () => {
    const rows = [
      row({ paramKey: 'housing_allowance', effectiveFrom: '2026-03-21', value: 1 }),
      row({ paramKey: 'housing_allowance', effectiveFrom: '2026-09-23', value: 2 }),
    ];
    expect(resolveParameters(rows, '2026-09-22').get('housing_allowance')?.value).toBe(1);
    expect(resolveParameters(rows, '2026-09-23').get('housing_allowance')?.value).toBe(2);
  });

  it('prefers the tenant row on the same date, then the highest version', () => {
    const rows = [
      row({ paramKey: 'housing_allowance', value: 1 }),
      row({ paramKey: 'housing_allowance', tenantId: TENANT, value: 2 }),
      row({ paramKey: 'housing_allowance', tenantId: TENANT, version: 2, value: 3 }),
    ];
    expect(resolveParameters(rows, '2026-12-01').get('housing_allowance')?.value).toBe(3);
  });

  it('a later platform date beats an earlier tenant row', () => {
    const rows = [
      row({ paramKey: 'housing_allowance', tenantId: TENANT, value: 2 }),
      row({ paramKey: 'housing_allowance', effectiveFrom: '2026-09-23', value: 9 }),
    ];
    expect(resolveParameters(rows, '2026-12-01').get('housing_allowance')?.value).toBe(9);
  });
});

describe('toPayrollRates', () => {
  it('refuses a year with a required value missing', () => {
    const rows = seededRows(1405).filter((r) => r.paramKey !== 'min_daily_wage');
    expect(() => toPayrollRates(1405, resolveParameters(rows, '2027-01-01'))).toThrow(BadRequestException);
  });

  it('turns verified when every value in force is verified', () => {
    const rows = seededRows(1405).map((r) => ({ ...r, verified: true }));
    const rates = toPayrollRates(1405, resolveParameters(rows, '2027-01-01'));
    expect(rates.verified).toBe(true);
    expect(rates.unverifiedKeys).toEqual([]);
  });
});

describe('isValidStatutoryValue', () => {
  it('rejects float rates, negative money and open-ended brackets in the middle', () => {
    expect(isValidStatutoryValue('employee_insurance_rate', 0.07)).toBe(false);
    expect(isValidStatutoryValue('employee_insurance_rate', '0.07')).toBe(true);
    expect(isValidStatutoryValue('housing_allowance', -1)).toBe(false);
    expect(
      isValidStatutoryValue('wage_tax_annual_brackets', [
        { upTo: null, rate: '0' },
        { upTo: 10, rate: '0.1' },
      ]),
    ).toBe(false);
    expect(
      isValidStatutoryValue('wage_tax_annual_brackets', [
        { upTo: 20, rate: '0' },
        { upTo: 10, rate: '0.1' },
        { upTo: null, rate: '0.2' },
      ]),
    ).toBe(false);
  });
});

describe('StatutoryService.setValue', () => {
  const setup = () => {
    const rows = seededRows(1405);
    const repository = {
      findForYear: jest.fn(async () => rows),
      insertVersion: jest.fn(async (tenantId: string, input: Partial<StatutoryParameterEntity>) => {
        const saved = { ...row({}), ...input, id: '99', tenantId, version: 1 };
        rows.push(saved);
        return saved;
      }),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new StatutoryService(
      repository as unknown as StatutoryRepository,
      audit as unknown as AuditService,
    );
    return { service, repository, audit };
  };
  const input = {
    fiscalYear: 1405,
    key: 'housing_allowance',
    value: 31_000_000,
    source: 'مصوبه هیئت وزیران',
    verified: true,
  };

  it('stores a tenant version and audits old and new value', async () => {
    const { service, audit } = setup();
    const list = await service.setValue(TENANT, 'user-1', input);
    const housing = list.find((p) => p.key === 'housing_allowance');
    expect(housing).toMatchObject({
      value: 31_000_000,
      verified: true,
      tenantOverride: true,
      sourceKind: StatutorySourceKind.TENANT,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        actorUserId: 'user-1',
        action: 'statutory.parameter.set',
        metadata: expect.objectContaining({
          previousValue: 30_000_000,
          value: 31_000_000,
        }),
      }),
    );
  });

  it('refuses an unknown key, a wrong shape and a date outside the year', async () => {
    const { service, repository } = setup();
    await expect(service.setValue(TENANT, 'u', { ...input, key: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setValue(TENANT, 'u', { ...input, value: '1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setValue(TENANT, 'u', { ...input, effectiveFrom: '2030-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.insertVersion).not.toHaveBeenCalled();
  });
});
