import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
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
});
