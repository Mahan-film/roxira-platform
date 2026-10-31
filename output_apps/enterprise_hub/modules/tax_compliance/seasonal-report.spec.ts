import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { jalaliToGregorian } from '../data_import/normaliser/normalise';
import { DEFAULT_VAT_RATE } from '../invoicing/constants/invoicing.constants';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { seededRates } from '../hr/statutory/__fixtures__/seeded-rates';
import { InvoicePostingService } from '../invoicing/services/invoice-posting.service';
import { invoiceRateLines, invoiceRialAmounts } from './reports/invoice-rial-amounts';
import { SeasonalReportController } from './controllers/seasonal-report.controller';
import { toCsv } from './reports/csv.util';
import { SeasonalReportRepository } from './reports/seasonal-report.repository';
import { SeasonalReportService } from './reports/seasonal-report.service';
import { jalaliQuarterRange } from './utils/jalali-quarter.util';

/** Tehran is UTC+3:30 with no DST since 1401, so local midnight = 20:30Z the day before. */
const tehranMidnightIso = (jy: number, jm: number, jd: number): string => {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return new Date(Date.UTC(gy, gm - 1, gd) - (3 * 60 + 30) * 60_000).toISOString();
};

describe('Jalali quarter boundaries', () => {
  it.each([
    [1, 1, 1, 4, 1],
    [2, 4, 1, 7, 1],
    [3, 7, 1, 10, 1],
  ])('q%i of 1405 starts on month %i and ends before month %i', (q, sm, sd, em, ed) => {
    const range = jalaliQuarterRange(1405, q);
    expect(range.from.toISOString()).toBe(tehranMidnightIso(1405, sm, sd));
    expect(range.to.toISOString()).toBe(tehranMidnightIso(1405, em, ed));
  });

  it('q4 ends at the first instant of next Farvardin', () => {
    const range = jalaliQuarterRange(1405, 4);
    expect(range.from.toISOString()).toBe(tehranMidnightIso(1405, 10, 1));
    expect(range.to.toISOString()).toBe(tehranMidnightIso(1406, 1, 1));
  });

  it('quarters are contiguous and half-open', () => {
    for (let q = 1; q < 4; q++) {
      expect(jalaliQuarterRange(1405, q).to.getTime()).toBe(jalaliQuarterRange(1405, q + 1).from.getTime());
    }
  });

  it('labels end on the right last day (Shahrivar 31, Azar 30, leap Esfand 30 in 1403, 29 in 1405)', () => {
    expect(jalaliQuarterRange(1405, 2).label).toBe('1405/04/01 تا 1405/06/31');
    expect(jalaliQuarterRange(1405, 3).label).toBe('1405/07/01 تا 1405/09/30');
    expect(jalaliQuarterRange(1403, 4).label).toBe('1403/10/01 تا 1403/12/30');
    expect(jalaliQuarterRange(1405, 4).label).toBe('1405/10/01 تا 1405/12/29');
  });

  it('rejects bad input', () => {
    expect(() => jalaliQuarterRange(1405, 5)).toThrow(BadRequestException);
    expect(() => jalaliQuarterRange(1405, 0)).toThrow(BadRequestException);
    expect(() => jalaliQuarterRange(12, 1)).toThrow(BadRequestException);
  });
});

function invoice(over: Partial<InvoiceEntity>): InvoiceEntity {
  return {
    id: 'i1',
    tenantId: 'tenant-a',
    taxInvoiceNumber: 'A-1',
    buyerInfo: { name: 'Buyer', nationalId: '123', economicCode: '456' },
    items: [{ description: 'x', quantity: 2, unitPrice: 1000, discount: 200, vatRate: 0.1, tax: 180, total: 1980 }],
    totalAmount: 2000,
    totalDiscount: 200,
    totalTax: 180,
    finalPayable: 1980,
    fxRate: 1,
    status: 'ISSUED',
    issuedAt: new Date('2026-05-01T00:00:00Z'),
    ...over,
  } as unknown as InvoiceEntity;
}

describe('SeasonalReportService', () => {
  const findIssuedBetween = jest.fn();
  const service = new SeasonalReportService({ findIssuedBetween } as unknown as SeasonalReportRepository);
  beforeEach(() => findIssuedBetween.mockReset());

  it('queries the exact quarter range for the caller tenant', async () => {
    findIssuedBetween.mockResolvedValue([]);
    await service.vatReport('tenant-a', 1405, 2);
    const [tenant, from, to] = findIssuedBetween.mock.calls[0];
    expect(tenant).toBe('tenant-a');
    expect(from.toISOString()).toBe(tehranMidnightIso(1405, 4, 1));
    expect(to.toISOString()).toBe(tehranMidnightIso(1405, 7, 1));
  });

  it('sums base and VAT per rate and never reports purchases as zero', async () => {
    findIssuedBetween.mockResolvedValue([
      invoice({}),
      invoice({
        id: 'i2',
        taxInvoiceNumber: 'A-2',
        items: [{ description: 'y', quantity: 1, unitPrice: 500, discount: 0, vatRate: 0, tax: 0, total: 500 }],
        totalAmount: 500,
        totalDiscount: 0,
        totalTax: 0,
        finalPayable: 500,
      }),
    ]);
    const report = await service.vatReport('tenant-a', 1405, 1);
    expect(report.sales.invoiceCount).toBe(2);
    expect(report.sales.taxableBase).toBe(1800 + 500);
    expect(report.sales.vat).toBe(180);
    expect(report.sales.byRate.map((r) => r.rate)).toEqual([0, 0.1]);
    expect(report.purchases.available).toBe(false);
    expect(report.notes.join(' ')).toContain('قالب رسمی');
  });

  it('converts foreign-currency invoices to rial with the stored fx rate', async () => {
    findIssuedBetween.mockResolvedValue([invoice({ fxRate: 10 })]);
    const report = await service.vatReport('tenant-a', 1405, 1);
    expect(report.sales.vat).toBe(1800);
  });

  it('tenant isolation: a different tenant gets its own (empty) data', async () => {
    findIssuedBetween.mockImplementation(async (tenantId: string) =>
      tenantId === 'tenant-a' ? [invoice({})] : [],
    );
    expect((await service.vatReport('tenant-a', 1405, 1)).sales.invoiceCount).toBe(1);
    expect((await service.vatReport('tenant-b', 1405, 1)).sales.invoiceCount).toBe(0);
  });

  it('CSV neutralises spreadsheet formulas in buyer names', async () => {
    findIssuedBetween.mockResolvedValue([invoice({ buyerInfo: { name: '=HYPERLINK("http://x")' } })]);
    const csv = await service.transactionsCsv('tenant-a', 1405, 1);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

/**
 * Multi-line FX invoice whose per-line conversions do not add up to the invoice total
 * (each x 0.333333 rounds separately). Reports must equal the ledger entry, not the line sum.
 */
describe('agreement with the issued journal entry (PR 902 amounts)', () => {
  const fxInvoice = invoice({
    fxRate: 0.333333,
    items: [
      { description: 'a', quantity: 1, unitPrice: 100.01, discount: 0, vatRate: 0.1, tax: 10, total: 110.01 },
      { description: 'b', quantity: 1, unitPrice: 100.02, discount: 0, vatRate: 0.1, tax: 10, total: 110.02 },
      { description: 'c', quantity: 1, unitPrice: 50.03, discount: 0, vatRate: 0, tax: 0, total: 50.03 },
    ],
    totalAmount: 250.06,
    totalDiscount: 0,
    totalTax: 20,
    finalPayable: 270.06,
  });

  it('matches InvoicePostingService.computeAmounts exactly', () => {
    const posting = new InvoicePostingService({} as never, {} as never, {} as never) as unknown as {
      computeAmounts(i: InvoiceEntity): { receivableMinor: bigint; vatMinor: bigint; salesMinor: bigint };
    };
    expect(invoiceRialAmounts(fxInvoice)).toEqual(posting.computeAmounts(fxInvoice));
  });

  it('rate lines sum exactly to the ledger sales and VAT minor units', () => {
    const amounts = invoiceRialAmounts(fxInvoice);
    const lines = invoiceRateLines(fxInvoice, amounts);
    expect(lines.reduce((a, l) => a + l.baseMinor, 0n)).toBe(amounts.salesMinor);
    expect(lines.reduce((a, l) => a + l.vatMinor, 0n)).toBe(amounts.vatMinor);
  });

  it('vat report, transactions list and ledger amounts agree', async () => {
    const findIssuedBetween = jest.fn().mockResolvedValue([fxInvoice]);
    const svc = new SeasonalReportService({ findIssuedBetween } as unknown as SeasonalReportRepository);
    const amounts = invoiceRialAmounts(fxInvoice);
    const report = await svc.vatReport('tenant-a', 1405, 1);
    const { rows } = await svc.transactions('tenant-a', 1405, 1);
    const sumRates = report.sales.byRate.reduce((a, r) => a + Number(r.taxableBase), 0);
    expect(report.sales.taxableBase).toBe(Number(amounts.salesMinor) / 100);
    expect(report.sales.vat).toBe(Number(amounts.vatMinor) / 100);
    expect(rows[0].taxableBase).toBe(report.sales.taxableBase);
    expect(rows[0].vat).toBe(report.sales.vat);
    expect(Math.round(sumRates * 100)).toBe(Number(amounts.salesMinor));
  });
});

describe('SeasonalReportController tenant source', () => {
  it('takes the tenant from the JWT, never from the query', async () => {
    const vatReport = jest.fn().mockResolvedValue({});
    const controller = new SeasonalReportController({ vatReport } as unknown as SeasonalReportService);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller
      .vat(request, { year: 1405, quarter: 1, tenantId: 'tenant-b' } as never)
      .catch(() => undefined);
    for (const call of vatReport.mock.calls) expect(call[0]).toBe('tenant-a');
  });
});

describe('csv util', () => {
  it('quotes commas and newlines', () => {
    expect(toCsv(['a'], [['x,y'], ['l1\nl2']])).toBe('﻿a\r\n"x,y"\r\n"l1\nl2"\r\n');
  });
});

/**
 * Sourced rate checks (docs/research/TAX_SEASONAL_AND_RATES_2026-10-31.md):
 * VAT stays 10% in 1405 per rade.ir (27 Tir 1405) after the rise to 10% in the
 * 1404 budget law. The 12% figure was only a 1405 budget BILL proposal.
 */
describe('statutory rates', () => {
  it('default VAT rate is 10% (1404 budget law, unchanged in 1405)', () => {
    expect(DEFAULT_VAT_RATE).toBe(0.1);
  });

  it('1405 payroll figures confirmed by the 1404-12-24 Supreme Labour Council decree (ekhtebar.ir)', () => {
    const rates = seededRates(1405);
    expect(rates.minDailyWage).toBe(5_541_850);
    expect(rates.housingAllowance).toBe(30_000_000);
  });
});
