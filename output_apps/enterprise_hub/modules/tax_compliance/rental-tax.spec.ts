import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { RentalTaxController } from './controllers/rental-tax.controller';
import { RentalTaxPreviewDto } from './dto/rental-tax-preview.dto';
import { RentalTaxService } from './services/rental-tax.service';

/** Made-up test figures, not the legal ones: see docs/tax/RENTAL_INCOME_TAX.md for what is sourced. */
const BRACKETS = [{ upTo: 500_000_000, rate: '0.15' }, { upTo: 1_000_000_000, rate: '0.2' }, { upTo: null, rate: '0.25' }];
const row = (key: string, value: unknown, over: Record<string, unknown> = {}) => ({
  paramKey: key, value, effectiveFrom: '2026-03-21', version: 1, source: 'test', verified: false, tenantId: null, ...over,
});
const PARAMS = [
  row('rental_expense_deduction_rate', '0.25'),
  row('income_exemption_ceiling_art57_art101', 100_000_000),
  row('income_tax_art131_brackets', BRACKETS),
];
const build = (rows: unknown[] = PARAMS) =>
  new RentalTaxService({ findForYear: jest.fn().mockResolvedValue(rows) } as unknown as StatutoryRepository);
const dto = (over: Partial<RentalTaxPreviewDto> = {}): RentalTaxPreviewDto => ({
  fiscalYear: 1405, rentReceived: '600000000', lessorIsOwner: true, ...over,
});

describe('rental income tax preview (DTX-03)', () => {
  it('owner: rent minus 25% for costs, Art. 57 exemption up to the ceiling, then the brackets', async () => {
    const p = await build().preview('tenant-a', dto());
    expect(p).toMatchObject({
      grossRent: '600000000.00', taxableRent: '450000000.00', exemptionAmount: '100000000.00',
      taxableAfterExemption: '350000000.00', tax: '52500000.00',
    });
    expect(p.voucher.posted).toBe(false);
    expect(p.parameters.map((x) => x.key)).toContain('rental_expense_deduction_rate');
  });

  it('other income uses up part of the exemption (note 2) and a large one all of it', async () => {
    const some = await build().preview('t', dto({ otherTaxableIncome: '60000000' }));
    expect(some.exemptionAmount).toBe('40000000.00');
    const none = await build().preview('t', dto({ otherTaxableIncome: '150000000' }));
    expect(none).toMatchObject({ exemptionAmount: '0.00', taxableAfterExemption: '450000000.00' });
  });

  it('a small rent is fully exempt', async () => {
    const p = await build().preview('t', dto({ rentReceived: '80000000' }));
    expect(p).toMatchObject({ taxableRent: '60000000.00', exemptionAmount: '60000000.00', tax: '0.00' });
  });

  it('a lessor who is not the owner is taxed on rent received minus rent paid, without the 25% cut', async () => {
    const p = await build().preview('t', dto({ lessorIsOwner: false, rentPaid: '200000000' }));
    expect(p.taxableRent).toBe('400000000.00');
    await expect(build().preview('t', dto({ lessorIsOwner: false }))).rejects.toThrow(/rentPaid/);
    const loss = await build().preview('t', dto({ lessorIsOwner: false, rentPaid: '900000000' }));
    expect(loss).toMatchObject({ taxableRent: '0.00', tax: '0.00' });
  });

  it('in-kind income is added and a minor under guardianship gets no exemption (note 1)', async () => {
    const inKind = await build().preview('t', dto({ inKindIncome: '200000000' }));
    expect(inKind.grossRent).toBe('800000000.00');
    const minor = await build().preview('t', dto({ minorUnderGuardianship: true }));
    expect(minor.exemptionAmount).toBe('0.00');
    expect(minor.taxableAfterExemption).toBe('450000000.00');
  });

  it('gross rent the accountant excluded leaves the base before the 25% cut', async () => {
    const p = await build().preview('t', dto({ exemptRentPortion: '400000000' }));
    // 200M left, 25% off = 150M, all inside the 100M ceiling? no: 100M exempt, 50M taxed
    expect(p).toMatchObject({ taxableRent: '150000000.00', exemptionAmount: '100000000.00', taxableAfterExemption: '50000000.00', tax: '7500000.00' });
  });

  it('refuses to compute without the statutory parameters, naming the missing one', async () => {
    await expect(build([]).preview('t', dto())).rejects.toThrow(BadRequestException);
    await expect(build([PARAMS[0], PARAMS[1]]).preview('t', dto())).rejects.toThrow(/income_tax_art131_brackets/);
  });

  it('the controller takes the tenant from the JWT, never from the body', async () => {
    const preview = jest.fn().mockResolvedValue({});
    const controller = new RentalTaxController({ preview } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.preview(request, { ...dto(), tenantId: 'tenant-b' } as never);
    expect(preview.mock.calls[0][0]).toBe('tenant-a');
  });
});
