import { CalendarService } from '../../calendar/calendar.service';
import { CountryPackRegistry } from '../country-pack.registry';
import { createIranPack } from '../ir/ir.pack';
import { TEST_COUNTRY, createTestPack } from './xx.pack';

const noopStatutory = { list: jest.fn(async () => []), ratesFor: jest.fn() };

describe('fake XX pack next to IR', () => {
  const registry = new CountryPackRegistry('IR');
  registry.register(createIranPack({ statutory: noopStatutory as never }));
  registry.register(createTestPack([{ key: 'xx_sales_tax_rate', value: '0.10' }, { key: 'xx_levy', value: 5 }]));

  it('both packs resolve by country and are independent', () => {
    expect(registry.list().map((pack) => pack.country).sort()).toEqual(['IR', 'XX']);
    expect(registry.get('IR').status).toBe('production');
    expect(registry.get('XX').status).toBe('test');
    expect(registry.resolve(undefined).country).toBe('IR');
    expect(registry.resolve('XX').country).toBe('XX');
  });

  it('nothing is shared: different calendars, currency, direction, charts, reports', () => {
    const ir = registry.get('IR');
    const xx = registry.get('XX');
    expect(xx.calendars.primary).toBe('gregorian');
    expect(ir.calendars.primary).toBe('jalali');
    expect(xx.locale.direction).toBe('ltr');
    expect(ir.locale.direction).toBe('rtl');
    expect(xx.locale.currency).toEqual({ code: 'XTS', minorUnits: 2 });
    expect(ir.locale.currency).toEqual({ code: 'IRR', minorUnits: 0 });
    expect(xx.chartTemplates.map((c) => c.key)).toEqual(['xx-basic']);
    expect(ir.chartTemplates.map((c) => c.key)).toEqual(['iran-trading', 'iran-service']);
    expect(xx.reportPack.map((r) => r.id)).toEqual(['xx-summary']);
  });

  it('the XX statutory port serves only its own invented keys', async () => {
    const xx = registry.get('XX');
    expect(xx.statutory.knownKeys()).toEqual(['xx_sales_tax_rate', 'xx_levy']);
    const values = await xx.statutory.valuesFor('tenant-1', 2025);
    expect(values.map((v) => v.key)).toEqual(['xx_sales_tax_rate', 'xx_levy']);
    expect(values.every((v) => v.verified === false && v.source === 'invented for tests')).toBe(true);
    expect(registry.get('IR').statutory.knownKeys()).not.toContain('xx_levy');
  });

  it('XX has no e-invoice or payroll adapter and says so clearly', () => {
    expect(() => registry.eInvoiceOf(TEST_COUNTRY)).toThrow(/no e-invoice scheme/);
    expect(() => registry.payrollOf(TEST_COUNTRY)).toThrow(/no payroll rules/);
    expect(registry.eInvoiceOf('IR').scheme).toBe('moadian');
  });

  it('the fiscal year spec of each pack drives the calendar service for its own country', () => {
    const calendar = new CalendarService();
    const ir = registry.get('IR').calendars.fiscalYear;
    const xx = registry.get('XX').calendars.fiscalYear;
    const day = { calendar: 'gregorian' as const, year: 2025, month: 3, day: 20 };
    expect(calendar.fiscalYearOf(ir, day)).toBe(1403);
    expect(calendar.fiscalYearOf(xx, day)).toBe(2025);
    expect(calendar.fiscalYearOf(xx, { ...day, month: 7, day: 1 })).toBe(2026);
  });

  it('contains no real country rule: every value is invented and unverified', () => {
    const pack = createTestPack();
    expect(JSON.stringify(pack.taxRules)).not.toMatch(/vat|moadian|iran/i);
    expect(pack.name).toMatch(/fake/i);
  });
});
