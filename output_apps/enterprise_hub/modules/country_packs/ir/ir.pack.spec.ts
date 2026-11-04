import 'reflect-metadata';
import { CHART_TEMPLATES } from '../../accounting/constants/iran-chart-template';
import { IRAN_FISCAL_YEAR } from '../../calendar/fiscal-year';
import { Currency } from '../../currency/enums/currency.enum';
import { seededRows } from '../../hr/statutory/__fixtures__/seeded-rates';
import { STATUTORY_KEYS } from '../../hr/statutory/statutory-catalogue';
import { StatutoryService } from '../../hr/statutory/statutory.service';
import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { EInvoiceType, InvoiceDirection, InvoiceSubject } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { MoadianSettlementMethod } from '../../tax_compliance/enums/moadian.enum';
import {
  MoadianMappingContext,
  mapInvoiceToMoadianPacket,
} from '../../tax_compliance/utils/moadian-packet.mapper';
import { CountryPackRegistry } from '../country-pack.registry';
import { createIranPack } from './ir.pack';

/** A real StatutoryService over a fake repository holding the migration's seed, recording the country asked for. */
function realStatutory(): { service: StatutoryService; countries: string[]; tenants: string[] } {
  const countries: string[] = [];
  const tenants: string[] = [];
  const repository = {
    findForYear: jest.fn(async (tenantId: string, country: string, year: number) => {
      tenants.push(tenantId);
      countries.push(country);
      return seededRows(year);
    }),
  };
  const audit = { record: jest.fn(async () => undefined) };
  return { service: new StatutoryService(repository as never, audit as never), countries, tenants };
}

const invoice = (): InvoiceResponseDto =>
  ({
    id: 'inv-1', taxInvoiceNumber: 'T-1', direction: InvoiceDirection.SALE, einvoiceType: EInvoiceType.WITH_BUYER,
    subject: InvoiceSubject.ORIGINAL, relatedInvoiceId: null, warehouseId: null, customerId: null,
    sellerInfo: { name: 'Seller', economicCode: '10101010101' },
    buyerInfo: { name: 'Buyer', nationalId: '0012345678', economicCode: '00123456780012' },
    items: [{ description: 'x', quantity: 2, unitPrice: 1_000_000, discount: 100_000, vatRate: 0.1, tax: 190_000, total: 2_090_000 }],
    currency: Currency.IRR, jurisdiction: InvoiceJurisdiction.IR, exchangeRate: 1, fxRate: 1, amountFx: null,
    baseCurrency: Currency.USD, totalAmount: 2_000_000, totalDiscount: 100_000, totalTax: 190_000, finalPayable: 2_090_000,
    baseTotalAmount: 0, baseTotalTax: 0, baseFinalPayable: 0, status: InvoiceStatus.ISSUED,
    issuedAt: new Date('2026-10-22T08:30:00Z'), paidAt: null, journalEntryId: null, paidJournalEntryId: null,
    reversalJournalEntryId: null, postingError: null, createdAt: new Date('2026-10-22T08:00:00Z'),
  }) as unknown as InvoiceResponseDto;

const context: MoadianMappingContext = {
  memoryId: 'A1B2C3', sellerEconomicCode: '10101010101', serial: 1, defaultSstid: '2330001234567',
  defaultMeasurementUnit: '1627', settlementMethod: MoadianSettlementMethod.CASH,
};

describe('Iran pack is adapters over existing code (behaviour unchanged)', () => {
  const { service } = realStatutory();
  const pack = createIranPack({ statutory: service });

  it('registers cleanly: the real Iranian charts pass the structural validation', () => {
    const registry = new CountryPackRegistry('IR');
    expect(() => registry.register(pack)).not.toThrow();
    expect(registry.resolve(null).country).toBe('IR');
  });

  it('chart templates are the same accounts, in the same order, as the accounting constants', () => {
    expect(pack.chartTemplates).toHaveLength(CHART_TEMPLATES.length);
    CHART_TEMPLATES.forEach((template, i) => {
      const mapped = pack.chartTemplates[i];
      expect(mapped.key).toBe(template.key);
      expect(mapped.name).toBe(template.name);
      expect(mapped.accounts.map((a) => [a.code, a.name, a.parentCode])).toEqual(
        template.accounts.map((a) => [a.code, a.name, a.parentCode]),
      );
      expect(mapped.accounts.map((a) => [a.accountType, a.level, a.reportLine])).toEqual(
        template.accounts.map((a) => [String(a.accountType), String(a.level), a.reportLine === null ? null : String(a.reportLine)]),
      );
    });
  });

  it('statutory port reads country IR and returns what StatutoryService.list returns', async () => {
    const direct = await realStatutory().service.list('tenant-1', 1404, 12);
    const fake = realStatutory();
    const viaPack = await createIranPack({ statutory: fake.service }).statutory.valuesFor('tenant-1', 1404);
    expect(fake.countries.every((c) => c === 'IR')).toBe(true);
    expect(fake.tenants.every((t) => t === 'tenant-1')).toBe(true);
    expect(viaPack.map((v) => [v.key, v.value, v.effectiveFrom, v.verified, v.source])).toEqual(
      direct.map((v) => [v.key, v.value, v.effectiveFrom, v.verified, v.source]),
    );
    expect(viaPack.length).toBeGreaterThan(0);
  });

  it('statutory month argument is passed through', async () => {
    const list = jest.fn(async () => []);
    const p = createIranPack({ statutory: { list, ratesFor: jest.fn() } as never });
    await p.statutory.valuesFor('t', 1404, 6);
    expect(list).toHaveBeenCalledWith('t', 1404, 6);
  });

  it('knownKeys is exactly the statutory catalogue and every tax rule key is in it', () => {
    expect([...pack.statutory.knownKeys()].sort()).toEqual(Object.keys(STATUTORY_KEYS).sort());
    for (const rule of pack.taxRules) {
      for (const key of rule.statutoryKeys) expect(Object.keys(STATUTORY_KEYS)).toContain(key);
    }
    expect(pack.taxRules.map((r) => r.kind)).toEqual(['vat', 'corporate_income_tax', 'wage_tax', 'social_insurance']);
  });

  it('holds no legal figure: tax rules contain keys only', () => {
    expect(JSON.stringify(pack.taxRules)).not.toMatch(/\d\.\d|\d{2,}/);
  });

  it('payroll adapter returns what StatutoryService.ratesFor returns', async () => {
    const direct = await realStatutory().service.ratesFor('tenant-1', 1404, 12);
    const viaPack = await pack.payroll.ratesFor('tenant-1', 1404, 12);
    expect(viaPack).toEqual(direct);
    expect(viaPack.year).toBe(1404);
  });

  it('e-invoice adapter maps an invoice to exactly the packet the Moadian mapper builds', () => {
    const direct = mapInvoiceToMoadianPacket(invoice(), context);
    const viaPack = pack.eInvoice.map(invoice(), context);
    expect(viaPack).toEqual(direct);
    expect(pack.eInvoice.scheme).toBe('moadian');
    expect(viaPack.header.inty).toBe(1);
  });

  it('e-invoice adapter keeps the mapper refusals (foreign invoice, draft)', () => {
    const foreign = { ...invoice(), jurisdiction: InvoiceJurisdiction.INTL } as InvoiceResponseDto;
    expect(() => pack.eInvoice.map(foreign, context)).toThrow(/domestic/);
    const draft = { ...invoice(), status: InvoiceStatus.DRAFT } as InvoiceResponseDto;
    expect(() => pack.eInvoice.map(draft, context)).toThrow(/ISSUED or PAID/);
  });

  it('calendar and locale describe Iran today', () => {
    expect(pack.calendars.fiscalYear).toBe(IRAN_FISCAL_YEAR);
    expect(pack.calendars.primary).toBe('jalali');
    expect(pack.calendars.weekendDays).toEqual([5]);
    expect(pack.locale).toMatchObject({ direction: 'rtl', timeZone: 'Asia/Tehran', currency: { code: 'IRR', minorUnits: 0 } });
    expect(pack.locale.languages[0]).toBe('fa-IR');
  });

  it('report pack points at routes that exist today', () => {
    expect(pack.reportPack.map((r) => r.id)).toEqual([
      'trial-balance', 'balance-sheet', 'income-statement', 'cash-flow', 'equity-changes',
      'vat-seasonal', 'seasonal-transactions', 'ledger-export',
    ]);
    expect(pack.reportPack.every((r) => r.route.startsWith('enterprise-hub/'))).toBe(true);
  });
});
