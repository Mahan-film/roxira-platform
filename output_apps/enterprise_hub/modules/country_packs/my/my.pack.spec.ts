import 'reflect-metadata';
import { CountryPackRegistry } from '../country-pack.registry';
import { CountryPackUnsupportedError } from '../country-pack.types';
import { validateCountryPack } from '../country-pack.validation';
import {
  MALAYSIA,
  MALAYSIA_SST_TAX_CODES,
  MALAYSIA_STATUTORY_THRESHOLDS,
  createMalaysiaPack,
} from './my.pack';

describe('Malaysia Country Pack Skeleton (T142)', () => {
  const pack = createMalaysiaPack();

  it('validates structurally through validateCountryPack', () => {
    expect(() => validateCountryPack(pack)).not.toThrow();
  });

  it('registers in CountryPackRegistry and resolves under MY', () => {
    const registry = new CountryPackRegistry('IR');
    registry.register(pack);
    expect(registry.has(MALAYSIA)).toBe(true);
    expect(registry.get(MALAYSIA).country).toBe('MY');
    expect(registry.resolve('MY').name).toBe('Malaysia');
  });

  it('metadata and locale match Malaysian specifications', () => {
    expect(pack.country).toBe('MY');
    expect(pack.name).toBe('Malaysia');
    expect(pack.status).toBe('production');
    expect(pack.version).toBe('1.0.0');
    expect(pack.locale).toEqual({
      languages: ['en-MY', 'ms-MY'],
      direction: 'ltr',
      displayDigits: 'latn',
      currency: { code: 'MYR', minorUnits: 2 },
      timeZone: 'Asia/Kuala_Lumpur',
    });
  });

  it('calendars describe Gregorian calendar with Saturday-Sunday weekend', () => {
    expect(pack.calendars.primary).toBe('gregorian');
    expect(pack.calendars.weekendDays).toEqual([6, 7]);
    expect(pack.calendars.fiscalYear).toEqual({
      calendar: 'gregorian',
      startMonth: 1,
      startDay: 1,
      labelBy: 'start',
    });
  });

  it('provides an MPERS-compliant SME chart of accounts with hierarchical integrity', () => {
    expect(pack.chartTemplates).toHaveLength(1);
    const chart = pack.chartTemplates[0];
    expect(chart.key).toBe('my-sme-standard');
    expect(chart.accounts.length).toBeGreaterThanOrEqual(30);

    const codes = new Set(chart.accounts.map((a) => a.code));
    expect(codes.size).toBe(chart.accounts.length);

    // Every non-null parentCode must resolve to an existing account in the chart
    for (const account of chart.accounts) {
      if (account.parentCode !== null) {
        expect(codes.has(account.parentCode)).toBe(true);
      }
    }

    // Must cover core account types
    const types = new Set(chart.accounts.map((a) => a.accountType));
    expect(types).toContain('ASSET');
    expect(types).toContain('LIABILITY');
    expect(types).toContain('EQUITY');
    expect(types).toContain('REVENUE');
    expect(types).toContain('EXPENSE');

    // Key Malaysian accounts present
    expect(codes.has('11200')).toBe(true); // Cash at Bank - MYR
    expect(codes.has('12300')).toBe(true); // SST Input Tax
    expect(codes.has('21300')).toBe(true); // SST Output Tax
    expect(codes.has('22100')).toBe(true); // EPF Payable
    expect(codes.has('22200')).toBe(true); // SOCSO Payable
    expect(codes.has('22300')).toBe(true); // EIS Payable
  });

  it('holds no legal figure in tax rules: contains statutory keys only', () => {
    expect(JSON.stringify(pack.taxRules)).not.toMatch(/\d\.\d|\d{2,}/);
    expect(pack.taxRules.map((r) => r.kind)).toEqual([
      'sales_tax',
      'service_tax',
      'einvoice_myinvois',
    ]);
  });

  it('every statutory key in tax rules exists in statutory port knownKeys', () => {
    const known = new Set(pack.statutory.knownKeys());
    for (const rule of pack.taxRules) {
      for (const key of rule.statutoryKeys) {
        expect(known.has(key)).toBe(true);
      }
    }
  });

  it('statutory port returns versioned thresholds with official source URLs', async () => {
    const values = await pack.statutory.valuesFor('tenant-my', 2026);
    expect(values.length).toBeGreaterThan(0);
    for (const val of values) {
      expect(val.source).toMatch(/^https:\/\//);
      expect(val.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(val.verified).toBe(true);
    }

    const sstThreshold = values.find((v) => v.key === 'my_sales_tax_threshold');
    expect(sstThreshold?.value).toBe(500000);

    const fnbThreshold = values.find((v) => v.key === 'my_service_tax_threshold_fnb');
    expect(fnbThreshold?.value).toBe(1500000);

    const einvoiceThreshold = values.find((v) => v.label.includes('Phase 4'));
    expect(einvoiceThreshold?.key).toBe('my_einvoice_phase4_threshold');
    expect(einvoiceThreshold?.value).toBe(1000000);

    const cancelWindow = values.find((v) => v.key === 'my_einvoice_cancellation_window_hours');
    expect(cancelWindow?.value).toBe(72);
  });

  it('versioned SST tax codes include standard sales (10%), reduced (5%), general service (8%), and F&B (6%)', () => {
    expect(MALAYSIA_SST_TAX_CODES.length).toBeGreaterThanOrEqual(6);

    const stStd = MALAYSIA_SST_TAX_CODES.find((c) => c.code === 'MY-ST-STD');
    expect(stStd?.rate).toBe('0.10');
    expect(stStd?.sourceUrl).toContain('mysst.customs.gov.my');

    const stRed = MALAYSIA_SST_TAX_CODES.find((c) => c.code === 'MY-ST-RED');
    expect(stRed?.rate).toBe('0.05');

    const vtGen = MALAYSIA_SST_TAX_CODES.find((c) => c.code === 'MY-VT-GEN');
    expect(vtGen?.rate).toBe('0.08');
    expect(vtGen?.effectiveFrom).toBe('2024-03-01');

    const vtFnb = MALAYSIA_SST_TAX_CODES.find((c) => c.code === 'MY-VT-FNB');
    expect(vtFnb?.rate).toBe('0.06');
  });

  it('report pack contains Malaysian statutory and financial statements', () => {
    expect(pack.reportPack.map((r) => r.id)).toEqual([
      'trial-balance',
      'balance-sheet',
      'income-statement',
      'cash-flow',
      'equity-changes',
      'sst-return',
    ]);
  });

  it('network adapters (eInvoice, payroll) are undefined in skeleton and throw on registry access', () => {
    expect(pack.eInvoice).toBeUndefined();
    expect(pack.payroll).toBeUndefined();

    const registry = new CountryPackRegistry('IR');
    registry.register(pack);

    expect(() => registry.eInvoiceOf('MY')).toThrow(CountryPackUnsupportedError);
    expect(() => registry.payrollOf('MY')).toThrow(CountryPackUnsupportedError);
  });
});
