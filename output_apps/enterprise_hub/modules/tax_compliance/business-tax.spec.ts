import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { BusinessTaxController } from './controllers/business-tax.controller';
import { BusinessTaxPreviewDto } from './dto/business-tax-preview.dto';
import { BusinessTaxService, splitByShares } from './services/business-tax.service';
import { bracketTax } from './utils/progressive-tax';

/** Made-up test figures (not the legal ones): see docs/tax/BUSINESS_OWNER_TAX.md for what is sourced. */
const BRACKETS = [
  { upTo: 500_000_000, rate: '0.15' },
  { upTo: 1_000_000_000, rate: '0.2' },
  { upTo: null, rate: '0.25' },
];
const row = (key: string, value: unknown, over: Record<string, unknown> = {}) => ({
  paramKey: key, value, effectiveFrom: '2026-03-21', version: 1, source: 'test', verified: false, tenantId: null, ...over,
});
const PARAMS = [
  row('income_tax_art131_brackets', BRACKETS),
  row('income_exemption_ceiling_art57_art101', 100_000_000),
  row('civil_partnership_max_exemptions', 2),
];
const build = (rows: unknown[] = PARAMS) =>
  new BusinessTaxService({ findForYear: jest.fn().mockResolvedValue(rows) } as unknown as StatutoryRepository);
const dto = (over: Partial<BusinessTaxPreviewDto> = {}): BusinessTaxPreviewDto => ({
  fiscalYear: 1405, mode: 'SOLE', units: [{ revenue: '1000000000', deductibleExpenses: '300000000' }], ...over,
});

describe('progressive tax', () => {
  it('taxes each band at its own rate', () => {
    // 600M: 500M x 15% + 100M x 20% = 95M rials = 9_500_000_000 minor units
    expect(bracketTax(60_000_000_000n, BRACKETS)).toBe(9_500_000_000n);
    expect(bracketTax(0n, BRACKETS)).toBe(0n);
    expect(bracketTax(150_000_000_000n, BRACKETS)).toBe(7_500_000_000n + 10_000_000_000n + 12_500_000_000n);
  });
});

describe('business owner tax preview (DTX-02)', () => {
  it('sole owner: income minus one exemption, then the brackets', async () => {
    const p = await build().preview('tenant-a', dto());
    expect(p.totalIncome).toBe('700000000.00');
    expect(p.taxpayers[0]).toMatchObject({ incomeShare: '700000000.00', exemption: '100000000.00', taxableIncome: '600000000.00', tax: '95000000.00' });
    expect(p.voucher.posted).toBe(false);
    expect(p.parameters.map((x) => x.key)).toContain('income_tax_art131_brackets');
  });

  it('several units are added up and only one exemption is deducted', async () => {
    const p = await build().preview('tenant-a', dto({
      units: [{ revenue: '400000000', deductibleExpenses: '0' }, { revenue: '300000000', deductibleExpenses: '0' }],
    }));
    expect(p.taxpayers).toHaveLength(1);
    expect(p.taxpayers[0].exemption).toBe('100000000.00');
  });

  it('a loss or income below the exemption pays no tax', async () => {
    const loss = await build().preview('tenant-a', dto({ units: [{ revenue: '10', deductibleExpenses: '500' }] }));
    expect(loss.totalTax).toBe('0.00');
    const small = await build().preview('tenant-a', dto({ units: [{ revenue: '50000000', deductibleExpenses: '0' }] }));
    expect(small.taxpayers[0]).toMatchObject({ exemption: '50000000.00', taxableIncome: '0.00', tax: '0.00' });
  });

  it('civil partnership: shares by percentage, at most two exemptions split equally, each partner taxed alone', async () => {
    const p = await build().preview('tenant-a', dto({
      mode: 'PARTNERSHIP',
      units: [{ revenue: '3000000000', deductibleExpenses: '0' }],
      partners: [{ shareBps: 5000 }, { shareBps: 3000 }, { shareBps: 2000 }],
    }));
    expect(p.exemptionsUsed).toBe(2);
    // pool 200M over 3 partners: 66,666,666.66 each, remainder to the first
    expect(p.taxpayers.map((t) => t.incomeShare)).toEqual(['1500000000.00', '900000000.00', '600000000.00']);
    expect(p.taxpayers.reduce((a, t) => a + Number(t.exemption), 0)).toBeCloseTo(200_000_000, 2);
    expect(p.taxpayers.every((t) => Number(t.tax) > 0)).toBe(true);
  });

  it('spouses count as one partner and the exemption goes to the first of them', async () => {
    const p = await build().preview('tenant-a', dto({
      mode: 'PARTNERSHIP',
      units: [{ revenue: '1000000000', deductibleExpenses: '0' }],
      partners: [{ name: 'Husband', shareBps: 5000, spouseGroup: 'A' }, { name: 'Wife', shareBps: 5000, spouseGroup: 'A' }],
    }));
    expect(p.exemptionsUsed).toBe(1);
    expect(p.taxpayers[0]).toMatchObject({ label: 'Husband', exemption: '100000000.00' });
    expect(p.taxpayers[1]).toMatchObject({ label: 'Wife', exemption: '0.00' });
  });

  it('refuses a partnership with one partner or shares that do not add up to 100%', async () => {
    const s = build();
    const base = { mode: 'PARTNERSHIP' as const };
    await expect(s.preview('t', dto({ ...base, partners: [{ shareBps: 10000 }] }))).rejects.toThrow(/حداقل دو شریک/);
    await expect(s.preview('t', dto({ ...base, partners: [{ shareBps: 5000 }, { shareBps: 4000 }] }))).rejects.toThrow(/۱۰۰٪/);
  });

  it('shares sum exactly to the total', () => {
    const parts = splitByShares(100n, [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it('refuses to compute without the statutory parameters, naming the missing one', async () => {
    await expect(build([]).preview('t', dto())).rejects.toThrow(BadRequestException);
    await expect(build([PARAMS[0], PARAMS[1]]).preview('t', dto())).rejects.toThrow(/civil_partnership_max_exemptions/);
  });

  it('the controller takes the tenant from the JWT, never from the body', async () => {
    const preview = jest.fn().mockResolvedValue({});
    const controller = new BusinessTaxController({ preview } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.preview(request, { ...dto(), tenantId: 'tenant-b' } as never);
    expect(preview.mock.calls[0][0]).toBe('tenant-a');
  });
});
