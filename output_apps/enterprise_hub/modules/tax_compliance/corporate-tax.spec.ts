import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CountryPackCls } from '../country_packs/country-pack.context';
import { CountryPackRegistry } from '../country_packs/country-pack.registry';
import { createTestPack, TEST_COUNTRY } from '../country_packs/xx/xx.pack';
import { isValidStatutoryValue, STATUTORY_KEYS } from '../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { CorporateTaxController } from './controllers/corporate-tax.controller';
import { CorporateTaxPreviewDto } from './dto/corporate-tax-preview.dto';
import { applyRate, CorporateTaxService } from './services/corporate-tax.service';

/**
 * Rates here are made-up test values chosen only to exercise the arithmetic. They are not the legal
 * rates (no official source is in docs/legal_sources/iran/, see docs/tax/CORPORATE_TAX_WORKBENCH.md).
 */
const row = (key: string, value: string, over: Record<string, unknown> = {}) => ({
  paramKey: key,
  value,
  effectiveFrom: '2026-03-21',
  version: 1,
  source: 'test',
  verified: false,
  tenantId: null,
  ...over,
});

const build = (rows: unknown[]) => {
  const findForYear = jest.fn().mockResolvedValue(rows);
  return { findForYear, service: new CorporateTaxService({ findForYear } as unknown as StatutoryRepository) };
};

const dto = (over: Partial<CorporateTaxPreviewDto> = {}): CorporateTaxPreviewDto => ({
  fiscalYear: 1405,
  accountingProfit: '1000000',
  nonDeductibleAdditions: '0',
  exemptIncomeAndDeductions: '0',
  lossesBroughtForward: '0',
  ...over,
});

const RATES = [row('corporate_tax_rate', '0.2'), row('corporate_tax_effective_floor', '0.1')];

describe('corporate tax provision preview (DTX-01)', () => {
  it('the keys exist as rates in the statutory catalogue and hold no figure in code', () => {
    expect(STATUTORY_KEYS.corporate_tax_rate.kind).toBe('rate');
    expect(STATUTORY_KEYS.corporate_tax_effective_floor.kind).toBe('rate');
    expect(isValidStatutoryValue('corporate_tax_rate', '0.2')).toBe(true);
    expect(isValidStatutoryValue('corporate_tax_rate', 0.2)).toBe(false);
  });

  it('applies the rate on taxable income and books nothing', async () => {
    const { service } = build(RATES);
    const p = await service.preview('tenant-a', dto({ nonDeductibleAdditions: '100000', lossesBroughtForward: '50000' }));
    expect(p.status).toBe('preview');
    expect(p.taxableIncome).toBe('1050000.00');
    expect(p.taxByRate).toBe('210000.00');
    expect(p.floorTax).toBe('100000.00');
    expect(p.provision).toBe('210000.00');
    expect(p.floorApplied).toBe(false);
    expect(p.effectiveRate).toBe('0.210000');
    expect(p.voucher.posted).toBe(false);
    const [dr, cr] = p.voucher.lines;
    expect(dr.debit).toBe('210000.00');
    expect(cr.credit).toBe('210000.00');
  });

  it('the effective-rate floor raises a provision that losses had pushed too low', async () => {
    const { service } = build(RATES);
    const p = await service.preview('tenant-a', dto({ lossesBroughtForward: '900000' }));
    expect(p.taxByRate).toBe('20000.00');
    expect(p.provision).toBe('100000.00');
    expect(p.floorApplied).toBe(true);
    expect(p.effectiveRate).toBe('0.100000');
  });

  it('a loss year has no provision, no voucher and no effective rate', async () => {
    const { service } = build(RATES);
    const p = await service.preview('tenant-a', dto({ accountingProfit: '-500000' }));
    expect(p.provision).toBe('0.00');
    expect(p.voucher.lines).toEqual([]);
    expect(p.effectiveRate).toBeNull();
  });

  it('refuses to compute without both parameters, naming the missing one', async () => {
    const { service } = build([row('corporate_tax_rate', '0.2')]);
    await expect(service.preview('tenant-a', dto())).rejects.toThrow(/corporate_tax_effective_floor/);
    await expect(build([]).service.preview('tenant-a', dto())).rejects.toThrow(BadRequestException);
  });

  it('a tenant row beats the platform default and the version used is reported', async () => {
    const { service } = build([
      ...RATES,
      row('corporate_tax_rate', '0.25', { tenantId: 'tenant-a', version: 2, verified: true }),
    ]);
    const p = await service.preview('tenant-a', dto());
    expect(p.parameters[0]).toMatchObject({ key: 'corporate_tax_rate', value: '0.25', version: 2, verified: true });
    expect(p.provision).toBe('250000.00');
  });

  it('rounds half up in exact minor units', () => {
    expect(applyRate(5n, '0.1')).toBe(1n); // 0.5 -> 1
    expect(applyRate(4n, '0.1')).toBe(0n);
    expect(applyRate(100_000_000_000_000n, '0.123456')).toBe(12_345_600_000_000n);
  });

  it('the controller takes the tenant from the JWT, never from the body', async () => {
    const preview = jest.fn().mockResolvedValue({});
    const controller = new CorporateTaxController({ preview } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.preview(request, { ...dto(), tenantId: 'tenant-b' } as never);
    expect(preview.mock.calls[0][0]).toBe('tenant-a');
  });

  it('queries statutory store using CountryPackRegistry country', async () => {
    const registry = new CountryPackRegistry('IR');
    const irPack = {
      interfaceVersion: 1,
      version: '1.0.0',
      country: 'IR',
      name: 'Iran',
      status: 'production' as const,
      locale: { languages: ['fa-IR'], direction: 'rtl' as const, displayDigits: 'arabext', currency: { code: 'IRR', minorUnits: 0 }, timeZone: 'Asia/Tehran' },
      calendars: { primary: 'jalali' as const, fiscalYear: { calendar: 'jalali' as const, startMonth: 1, startDay: 1, labelBy: 'start' as const }, weekendDays: [5] },
      chartTemplates: [],
      taxRules: [{ kind: 'corporate_income_tax', label: 'Tax', statutoryKeys: ['corporate_tax_rate', 'corporate_tax_effective_floor'] }],
      statutory: { knownKeys: () => ['corporate_tax_rate', 'corporate_tax_effective_floor'], valuesFor: jest.fn(async () => []) },
      reportPack: [],
    };
    registry.register(irPack);

    const findForYear = jest.fn().mockResolvedValue(RATES);
    const service = new CorporateTaxService({ findForYear } as unknown as StatutoryRepository, registry);

    await service.preview('tenant-a', dto());
    expect(findForYear).toHaveBeenCalledWith('tenant-a', 'IR', 1405);
  });

  it('queries statutory store using active CLS country pack when non-default', async () => {
    const registry = new CountryPackRegistry('IR');
    const xxPack = createTestPack();
    registry.register(xxPack);

    const findForYear = jest.fn().mockResolvedValue(RATES);
    const service = new CorporateTaxService({ findForYear } as unknown as StatutoryRepository, registry);

    await CountryPackCls.run(xxPack, async () => {
      await service.preview('tenant-xx', dto(), TEST_COUNTRY);
    });

    expect(findForYear).toHaveBeenCalledWith('tenant-xx', TEST_COUNTRY, 1405);
  });

  it('reads corporate tax rule keys and country from the pack registry when provided', async () => {
    const findForYear = jest.fn().mockResolvedValue([
      row('corporate_tax_rate', '0.25'),
      row('corporate_tax_effective_floor', '0.10'),
    ]);
    const fakePack = {
      country: 'IR',
      taxRules: [
        {
          kind: 'corporate_income_tax',
          label: 'مالیات شرکت‌ها',
          statutoryKeys: ['corporate_tax_rate', 'corporate_tax_effective_floor'],
        },
      ],
    };
    const packRegistry = {
      resolve: jest.fn(() => fakePack),
    };
    const service = new CorporateTaxService(
      { findForYear } as unknown as StatutoryRepository,
      packRegistry as never,
    );
    const result = await service.preview('tenant-1', dto({ accountingProfit: '1000000000.00' }));
    expect(packRegistry.resolve).toHaveBeenCalled();
    expect(findForYear).toHaveBeenCalledWith('tenant-1', 'IR', 1405);
    expect(result.provision).toBe('250000000.00');
  });

  it('falls back to default statutory keys and IR when no pack registry is provided', async () => {
    const findForYear = jest.fn().mockResolvedValue(RATES);
    const service = new CorporateTaxService({ findForYear } as unknown as StatutoryRepository);
    const result = await service.preview('tenant-1', dto({ accountingProfit: '1000000000.00' }));
    expect(findForYear).toHaveBeenCalledWith('tenant-1', 'IR', 1405);
    expect(result.provision).toBe('250000000.00');
  });
});
