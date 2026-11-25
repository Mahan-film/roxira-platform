import 'reflect-metadata';
import { CountryPackRegistry } from '../country-pack.registry';
import { validateCountryPack } from '../country-pack.validation';
import {
  GERMANY,
  createGermanyPack,
} from './de.pack';
import {
  DE_REVERSE_CHARGE_CODES,
  DE_VAT_RATES,
  assertZeroRatedEuInvoiceAllowed,
  determineReturnFrequency,
  evaluateKleinunternehmerStatus,
  validateSection34aInvoice,
  validateViesEuVatNumber,
} from './de-vat';
import { DE_NEUTRAL_CHART_TEMPLATE } from './de-chart-template';

describe('Germany Country Pack (T188)', () => {
  const pack = createGermanyPack();

  describe('Pack structure and registry integration', () => {
    it('validates structurally through validateCountryPack', () => {
      expect(() => validateCountryPack(pack)).not.toThrow();
    });

    it('registers in CountryPackRegistry and resolves under DE', () => {
      const registry = new CountryPackRegistry('IR');
      registry.register(pack);
      expect(registry.has(GERMANY)).toBe(true);
      expect(registry.get(GERMANY).country).toBe('DE');
      expect(registry.resolve('DE').name).toBe('Germany');
    });

    it('metadata, locale and calendars match German requirements', () => {
      expect(pack.country).toBe('DE');
      expect(pack.name).toBe('Germany');
      expect(pack.status).toBe('beta');
      expect(pack.version).toBe('1.0.0');
      expect(pack.locale).toEqual({
        languages: ['de-DE', 'en-DE'],
        direction: 'ltr',
        displayDigits: 'latn',
        currency: { code: 'EUR', minorUnits: 2 },
        timeZone: 'Europe/Berlin',
      });
      expect(pack.calendars.primary).toBe('gregorian');
      expect(pack.calendars.weekendDays).toEqual([6, 7]);
      expect(pack.calendars.fiscalYear).toEqual({
        calendar: 'gregorian',
        startMonth: 1,
        startDay: 1,
        labelBy: 'start',
      });
    });
  });

  describe('VAT rates data (19% / 7% / zero-rate)', () => {
    it('contains standard 19% and reduced 7% VAT rates with effective-dated legal basis', () => {
      const std = DE_VAT_RATES.find((r) => r.code === 'DE_VAT_STANDARD');
      expect(std).toBeDefined();
      expect(std?.rate).toBe('0.19');
      expect(std?.percent).toBe(19);
      expect(std?.legalBasis).toBe('§ 12 Abs. 1 UStG');
      expect(std?.verified).toBe(true);

      const red = DE_VAT_RATES.find((r) => r.code === 'DE_VAT_REDUCED');
      expect(red).toBeDefined();
      expect(red?.rate).toBe('0.07');
      expect(red?.percent).toBe(7);
      expect(red?.legalBasis).toBe('§ 12 Abs. 2 UStG');
      expect(red?.verified).toBe(true);
    });

    it('contains zero-rated intra-community, export and photovoltaic rates', () => {
      const intra = DE_VAT_RATES.find((r) => r.code === 'DE_VAT_ZERO_INTRA_COMMUNITY');
      expect(intra).toBeDefined();
      expect(intra?.rate).toBe('0.00');
      expect(intra?.legalBasis).toContain('§ 4 Nr. 1b');

      const photo = DE_VAT_RATES.find((r) => r.code === 'DE_VAT_ZERO_PHOTOVOLTAIC');
      expect(photo).toBeDefined();
      expect(photo?.rate).toBe('0.00');
      expect(photo?.legalBasis).toContain('§ 12 Abs. 3 UStG');
    });
  });

  describe('§ 19 UStG Kleinunternehmer thresholds with mid-year warning and stop', () => {
    it('returns EXEMPT status when current and prior year turnover are well within thresholds', () => {
      // Prior year 15,000 EUR (1,500,000 cents), current year 50,000 EUR (5,000,000 cents)
      const res = evaluateKleinunternehmerStatus(1500000n, 5000000n);
      expect(res.status).toBe('EXEMPT');
      expect(res.canIssueExemptInvoice).toBe(true);
      expect(res.warnings).toHaveLength(0);
    });

    it('triggers WARNING when current year turnover reaches 90% of statutory ceiling (>= EUR 90,000)', () => {
      // Current year 91,000 EUR (9,100,000 cents)
      const res = evaluateKleinunternehmerStatus(1500000n, 9100000n);
      expect(res.status).toBe('WARNING');
      expect(res.canIssueExemptInvoice).toBe(true);
      expect(res.warnings.length).toBeGreaterThanOrEqual(1);
      expect(res.warnings[0]).toContain('reached 90% of statutory ceiling');
    });

    it('triggers STOP_EXCEEDED and blocks exempt invoices immediately when current year turnover crosses EUR 100,000', () => {
      // Current year 100,001 EUR (10,000,100 cents)
      const res = evaluateKleinunternehmerStatus(2000000n, 10000100n);
      expect(res.status).toBe('STOP_EXCEEDED');
      expect(res.canIssueExemptInvoice).toBe(false);
      expect(res.warnings.length).toBeGreaterThanOrEqual(1);
      expect(res.warnings[0]).toContain('exceeds statutory Kleinunternehmer ceiling');
      expect(res.warnings[0]).toContain('Small business exemption terminated immediately');
    });

    it('triggers STOP_EXCEEDED when prior year turnover exceeded EUR 25,000', () => {
      // Prior year 26,000 EUR (2,600,000 cents)
      const res = evaluateKleinunternehmerStatus(2600000n, 1000000n);
      expect(res.status).toBe('STOP_EXCEEDED');
      expect(res.canIssueExemptInvoice).toBe(false);
      expect(res.warnings[0]).toContain('Prior year turnover');
    });
  });

  describe('§ 34a UStDV invoice fields validation', () => {
    it('validates invoice with Steuernummer and § 19 notice', () => {
      const res = validateSection34aInvoice({
        taxNumber: '12/345/67890',
        exemptNoticeText: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('validates invoice with USt-IdNr. and § 19 notice', () => {
      const res = validateSection34aInvoice({
        vatId: 'DE123456789',
        exemptNoticeText: 'Rechnung enthält keine Umsatzsteuer gem. Kleinunternehmerregelung § 19 Abs. 1 UStG',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects invoice when all tax identifiers are missing', () => {
      const res = validateSection34aInvoice({
        taxNumber: '',
        vatId: null,
        smallBusinessId: undefined,
        exemptNoticeText: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
      });
      expect(res.valid).toBe(false);
      expect(res.missingIdentifiers).toBe(true);
      expect(res.errors[0]).toContain('must carry at least one tax identifier');
    });

    it('rejects invoice when § 19 exemption notice is missing', () => {
      const res = validateSection34aInvoice({
        taxNumber: '12/345/67890',
        exemptNoticeText: '',
      });
      expect(res.valid).toBe(false);
      expect(res.missingExemptNotice).toBe(true);
      expect(res.errors[0]).toContain('must state statutory exemption note');
    });

    it('enforces mandatory "Gutschrift" text for self-billing invoices', () => {
      const invalidSb = validateSection34aInvoice({
        taxNumber: '12/345/67890',
        exemptNoticeText: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        isSelfBilling: true,
        selfBillingText: 'Invoice',
      });
      expect(invalidSb.valid).toBe(false);
      expect(invalidSb.missingSelfBillingNotice).toBe(true);
      expect(invalidSb.errors[0]).toContain('Gutschrift');

      const validSb = validateSection34aInvoice({
        taxNumber: '12/345/67890',
        exemptNoticeText: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        isSelfBilling: true,
        selfBillingText: 'Gutschrift - Abrechnung',
      });
      expect(validSb.valid).toBe(true);
    });
  });

  describe('§ 18 return frequency and 1/11 special prepayment', () => {
    it('determines monthly return frequency and calculates exact 1/11th special prepayment for prior year VAT > EUR 9,000', () => {
      // Prior year VAT payable 11,000 EUR (1,100,000 cents)
      const res = determineReturnFrequency(1100000n);
      expect(res.frequency).toBe('MONTHLY');
      expect(res.permanentExtensionRequiresPrepayment).toBe(true);
      expect(res.specialPrepaymentDeadline).toBe('02-10');

      // Total prior year liability 11,000 EUR (1,100,000 cents) -> 1/11th = 1,000 EUR (100,000 cents)
      const prepayment = res.calculateSpecialPrepayment(1100000n);
      expect(prepayment).toBe(100000n);

      // Total prior year liability 22,000 EUR -> 1/11th = 2,000 EUR (200,000 cents)
      expect(res.calculateSpecialPrepayment(2200000n)).toBe(200000n);
    });

    it('determines quarterly return frequency without special prepayment for prior year VAT between EUR 2,000 and EUR 9,000', () => {
      // Prior year VAT payable 5,000 EUR (500,000 cents)
      const res = determineReturnFrequency(500000n);
      expect(res.frequency).toBe('QUARTERLY');
      expect(res.permanentExtensionRequiresPrepayment).toBe(false);
      expect(res.calculateSpecialPrepayment(500000n)).toBe(0n);
    });

    it('determines annual return exemption eligibility for prior year VAT <= EUR 2,000', () => {
      // Prior year VAT payable 1,500 EUR (150,000 cents)
      const res = determineReturnFrequency(150000n);
      expect(res.frequency).toBe('ANNUAL_EXEMPT');
      expect(res.permanentExtensionRequiresPrepayment).toBe(false);
    });
  });

  describe('§ 13b reverse charge codes (verified: false)', () => {
    it('includes all primary § 13b categories with verified: false', () => {
      expect(DE_REVERSE_CHARGE_CODES.length).toBeGreaterThanOrEqual(8);

      const codes = new Set(DE_REVERSE_CHARGE_CODES.map((c) => c.code));
      expect(codes.has('13b_foreign_entrepreneur')).toBe(true);
      expect(codes.has('13b_real_estate_transfer')).toBe(true);
      expect(codes.has('13b_construction_services')).toBe(true);
      expect(codes.has('13b_energy_supplies')).toBe(true);
      expect(codes.has('13b_scrap_metal')).toBe(true);
      expect(codes.has('13b_mobile_phones')).toBe(true);
      expect(codes.has('13b_electronics')).toBe(true);
      expect(codes.has('13b_telecom_services')).toBe(true);

      for (const item of DE_REVERSE_CHARGE_CODES) {
        expect(item.verified).toBe(false);
        expect(item.legalBasis).toContain('§ 13b');
      }
    });
  });

  describe('VIES check before zero-rated EU invoice', () => {
    it('validates standard EU VAT ID formats', () => {
      expect(validateViesEuVatNumber('FR12345678901', 'FR').valid).toBe(true);
      expect(validateViesEuVatNumber('NL123456789B01', 'NL').valid).toBe(true);
      expect(validateViesEuVatNumber('ATU12345678', 'AT').valid).toBe(true);
      expect(validateViesEuVatNumber('IT12345678901', 'IT').valid).toBe(true);
    });

    it('rejects German domestic VAT ID as intra-community EU supply', () => {
      const res = validateViesEuVatNumber('DE123456789', 'DE');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('German domestic VAT number cannot be used');
    });

    it('assertZeroRatedEuInvoiceAllowed allows valid EU customer VAT ID', () => {
      const allowed = assertZeroRatedEuInvoiceAllowed('NL123456789B01', 'NL');
      expect(allowed.allowed).toBe(true);
      expect(allowed.normalizedVatId).toBe('NL123456789B01');
    });

    it('assertZeroRatedEuInvoiceAllowed strictly blocks invoice when VAT ID is missing or invalid', () => {
      const missing = assertZeroRatedEuInvoiceAllowed('', 'FR');
      expect(missing.allowed).toBe(false);
      expect(missing.error).toContain('requires a valid EU VAT ID');

      const invalid = assertZeroRatedEuInvoiceAllowed('INVALID_FR_VAT', 'FR');
      expect(invalid.allowed).toBe(false);
      expect(invalid.error).toContain('VIES validation failed');
    });

    it('assertZeroRatedEuInvoiceAllowed rejects domestic German destination for zero-rating', () => {
      const domestic = assertZeroRatedEuInvoiceAllowed('DE999999999', 'DE');
      expect(domestic.allowed).toBe(false);
      expect(domestic.error).toContain('strictly disallowed for domestic German supplies');
    });
  });

  describe('Neutral SKR03/04-compatible chart template and separate Grundsteuer account', () => {
    it('contains neutral Standard-Kontenrahmen DE with hierarchical validity', () => {
      const chart = DE_NEUTRAL_CHART_TEMPLATE;
      expect(chart.key).toBe('de-skr-neutral');
      expect(chart.accounts.length).toBeGreaterThanOrEqual(40);

      const codes = new Set(chart.accounts.map((a) => a.code));
      expect(codes.size).toBe(chart.accounts.length);

      for (const account of chart.accounts) {
        if (account.parentCode !== null) {
          expect(codes.has(account.parentCode)).toBe(true);
        }
      }

      const types = new Set(chart.accounts.map((a) => a.accountType));
      expect(types).toContain('ASSET');
      expect(types).toContain('LIABILITY');
      expect(types).toContain('EQUITY');
      expect(types).toContain('REVENUE');
      expect(types).toContain('EXPENSE');
    });

    it('has a dedicated, separate Grundsteuer account (4510) under Betriebliche Steuern (4500)', () => {
      const chart = DE_NEUTRAL_CHART_TEMPLATE;
      const grundsteuer = chart.accounts.find((a) => a.code === '4510');
      expect(grundsteuer).toBeDefined();
      expect(grundsteuer?.name).toBe('Grundsteuer');
      expect(grundsteuer?.accountType).toBe('EXPENSE');
      expect(grundsteuer?.level).toBe('TAFSILI');
      expect(grundsteuer?.parentCode).toBe('4500'); // Betriebliche Steuern
      expect(grundsteuer?.reportLine).toBe('expenses.taxes.property_tax');

      // Separate from Gewerbesteuer and Kfz-Steuer
      const gewerbesteuer = chart.accounts.find((a) => a.code === '4520');
      expect(gewerbesteuer).toBeDefined();
      expect(gewerbesteuer?.name).toBe('Gewerbesteuer');

      const kfzSteuer = chart.accounts.find((a) => a.code === '4530');
      expect(kfzSteuer).toBeDefined();
      expect(kfzSteuer?.name).toBe('Kraftfahrzeugsteuer');
    });
  });
});
