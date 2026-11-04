import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { DoctorWithholdingController } from './controllers/doctor-withholding.controller';
import { DoctorWithholdingPreviewDto } from './dto/doctor-withholding-preview.dto';
import { DoctorWithholdingService, monthsLate, remitDeadline } from './services/doctor-withholding.service';

/** Made-up test rates, not asserted legal rates: see docs/tax/DOCTOR_FEE_WITHHOLDING.md. */
const row = (key: string, value: unknown, over: Record<string, unknown> = {}) => ({
  paramKey: key, value, effectiveFrom: '2026-03-21', version: 1, source: 'test', verified: false, tenantId: null, ...over,
});
const PARAMS = [
  row('doctor_fee_withholding_rate', '0.1'),
  row('withholding_late_penalty_rate', '0.1'),
  row('withholding_late_penalty_monthly_rate', '0.025'),
];
const build = (rows: unknown[] = PARAMS) =>
  new DoctorWithholdingService({ findForYear: jest.fn().mockResolvedValue(rows) } as unknown as StatutoryRepository);
const dto = (over: Partial<DoctorWithholdingPreviewDto> = {}): DoctorWithholdingPreviewDto => ({
  fiscalYear: 1405,
  payments: [{ paidOn: '2026-06-01', amount: '500000000', doctorRef: 'dr-1', kind: 'FEE' }],
  ...over,
});

describe('Jalali deadline helpers', () => {
  it('the deadline is the end of the following Jalali month', () => {
    // 2026-06-01 is 1405/03/11 (Khordad): deadline = end of Tir = 1405/04/31 = 2026-07-22
    expect(remitDeadline('2026-06-01')).toBe('2026-07-22');
    // Esfand rolls into Farvardin of the next year: 1405/12/10 = 2027-03-01 -> end of 1406/01 = 2027-04-20
    expect(remitDeadline('2027-03-01')).toBe('2027-04-20');
  });
  it('counts started Jalali months after the deadline', () => {
    expect(monthsLate('2026-07-22', '2026-07-22')).toBe(0);
    expect(monthsLate('2026-07-22', '2026-07-23')).toBe(1); // 1405/05/01
    expect(monthsLate('2026-07-22', '2026-08-30')).toBe(2); // 1405/06/08 -> month 2 started
  });
});

describe('doctors fee advance withholding preview (DTX-04)', () => {
  it('withholds the rate of a fee and shows the net to the doctor', async () => {
    const p = await build().preview('tenant-a', dto());
    expect(p.lines[0]).toMatchObject({ withheld: '50000000.00', netToDoctor: '450000000.00', excludedReason: null, remitBy: '2026-07-22' });
    expect(p.totalWithheld).toBe('50000000.00');
    expect(p.byDoctor).toEqual([{ doctorRef: 'dr-1', gross: '500000000.00', withheld: '50000000.00' }]);
    expect(p.voucher.posted).toBe(false);
    expect(p.latePenalty).toBeNull();
  });

  it('salary and bonus payments are excluded with a reason', async () => {
    const p = await build().preview('t', dto({
      payments: [
        { paidOn: '2026-06-01', amount: '100000000', doctorRef: 'dr-1', kind: 'SALARY' },
        { paidOn: '2026-06-01', amount: '100000000', doctorRef: 'dr-1', kind: 'BONUS' },
        { paidOn: '2026-06-01', amount: '100000000', doctorRef: 'dr-1', kind: 'FEE' },
      ],
    }));
    expect(p.lines.map((l) => l.withheld)).toEqual(['0.00', '0.00', '10000000.00']);
    expect(p.lines[0].excludedReason).toMatch(/حقوق/);
    expect(p.byDoctor[0]).toMatchObject({ gross: '300000000.00', withheld: '10000000.00' });
  });

  it('rounds half up in exact minor units', async () => {
    const p = await build().preview('t', dto({ payments: [{ paidOn: '2026-06-01', amount: '0.05', doctorRef: 'd', kind: 'FEE' }] }));
    expect(p.lines[0].withheld).toBe('0.01'); // 0.005 rounds up
  });

  it('late remittance adds the Art. 199 penalty: flat share plus a monthly share per month', async () => {
    const p = await build().preview('t', dto({ remittedOn: '2026-08-30' }));
    // tax 50,000,000: 10% = 5,000,000 + 2.5% x 2 months = 2,500,000
    expect(p.latePenalty).toEqual({ remittedOn: '2026-08-30', monthsLate: 2, amount: '7500000.00' });
    const onTime = await build().preview('t', dto({ remittedOn: '2026-07-22' }));
    expect(onTime.latePenalty).toMatchObject({ monthsLate: 0, amount: '0.00' });
  });

  it('refuses to compute without the statutory parameters, naming the missing one', async () => {
    await expect(build([]).preview('t', dto())).rejects.toThrow(BadRequestException);
    await expect(build([PARAMS[0], PARAMS[1]]).preview('t', dto())).rejects.toThrow(/withholding_late_penalty_monthly_rate/);
  });

  it('the controller takes the tenant from the JWT, never from the body', async () => {
    const preview = jest.fn().mockResolvedValue({});
    const controller = new DoctorWithholdingController({ preview } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.preview(request, { ...dto(), tenantId: 'tenant-b' } as never);
    expect(preview.mock.calls[0][0]).toBe('tenant-a');
  });
});
