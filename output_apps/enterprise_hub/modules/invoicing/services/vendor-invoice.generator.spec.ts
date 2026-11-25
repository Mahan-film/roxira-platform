import { BadRequestException } from '@nestjs/common';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import {
  EffectiveTaxTreatmentRegistry,
  GaplessNumberSequencer,
  MemorySequencerStore,
  PostgresSequencerStore,
  VendorInvoiceGenerator,
  VendorInvoiceRequest,
  getCurrencyExponent,
  multiplyMinorByQuantity,
  minorToExactMajorString,
  EU_MEMBER_COUNTRIES,
} from './vendor-invoice.generator';
import {
  MY_B2B_INVOICE_REQUEST,
  EU_B2B_INVOICE_REQUEST,
  EU_B2C_REFUND_REQUEST,
  CUSTOMER_EU_B2B,
  CUSTOMER_EU_B2C,
  CUSTOMER_MY_B2B,
  SUPPLIER_ROXIRA_MY,
} from '../__fixtures__/vendor-invoice.fixture';

describe('VendorInvoiceGenerator (T321 / R31)', () => {
  let registry: EffectiveTaxTreatmentRegistry;
  let sequencer: GaplessNumberSequencer;
  let generator: VendorInvoiceGenerator;

  beforeEach(() => {
    registry = new EffectiveTaxTreatmentRegistry();
    sequencer = new GaplessNumberSequencer();
    generator = new VendorInvoiceGenerator(registry, sequencer);
  });

  describe('1. MY B2B Invoice Fixture', () => {
    it('produces valid Malaysian B2B invoice with gapless numbering and effective 8% SST line', () => {
      const { sequenceNumber } = sequencer.nextNumber(MY_B2B_INVOICE_REQUEST.series);
      const doc = generator.generate(MY_B2B_INVOICE_REQUEST, sequenceNumber);

      expect(doc.documentType).toBe('INVOICE');
      expect(doc.documentNumber).toBe('INV-2026-000001');
      expect(doc.totalNetMinor).toBe(550000n);
      expect(doc.lines[0].taxRateDecimal).toBe('0.08');
      expect(doc.lines[0].taxCode).toBe('MY-VT-GEN');
      expect(doc.lines[0].taxMinor).toBe(36000n);
      expect(doc.lines[0].grossMinor).toBe(486000n);
      expect(doc.totalTaxMinor).toBe(44000n);
      expect(doc.totalGrossMinor).toBe(594000n);
      expect(doc.reverseCharge).toBe(false);
      expect(doc.statutoryMentions).toContain('Service Tax (SST) 8% applicable under the Service Tax Act 2018.');

      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.taxInvoiceNumber).toBe('INV-2026-000001');
      expect(ledgerDto.direction).toBe(InvoiceDirection.SALE);
      expect(ledgerDto.items[0].unitPrice).toBe(4500); // Exact major units: RM 4,500.00
      expect(ledgerDto.items[0].vatRate).toBe(0.08);
      expect(ledgerDto.items[1].unitPrice).toBe(500); // Exact major units: RM 500.00
      expect(ledgerDto.items[1].vatRate).toBe(0.08);
    });
  });

  describe('2. EU B2B Invoice Fixture & hasVerifiedVatId', () => {
    it('produces valid EU B2B cross-border invoice with reverse-charge when VAT ID is verified', () => {
      const { sequenceNumber } = sequencer.nextNumber(EU_B2B_INVOICE_REQUEST.series);
      const doc = generator.generate(EU_B2B_INVOICE_REQUEST, sequenceNumber);

      expect(doc.currency).toBe(Currency.EUR);
      expect(doc.totalNetMinor).toBe(100000n);
      expect(doc.totalTaxMinor).toBe(0n);
      expect(doc.reverseCharge).toBe(true);
      expect(doc.statutoryMentions).toContain('Reverse charge: Customer to account for VAT under Article 196 of Council Directive 2006/112/EC.');

      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.items[0].unitPrice).toBe(200);
      expect(ledgerDto.items[0].vatRate).toBe(0);
    });

    it('charges standard EU VAT when EU B2B customer VAT ID is unverified or missing', () => {
      const unverified = { ...EU_B2B_INVOICE_REQUEST, customer: { ...CUSTOMER_EU_B2B, verifiedTaxId: false } };
      const doc = generator.generate(unverified, 1);

      expect(doc.reverseCharge).toBe(false);
      expect(doc.lines[0].taxCode).toBe('EU-STANDARD-VAT');
      expect(doc.lines[0].taxRateDecimal).toBe('0.20');
      expect(doc.totalTaxMinor).toBe(20000n);
      expect(doc.statutoryMentions).toContain('Standard VAT charged: VAT identification number not verified on VIES.');

      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.items[0].unitPrice).toBe(200);
      expect(ledgerDto.items[0].vatRate).toBe(0.2);
    });
  });

  describe('3. EU B2C Invoice & Credit Note Fixtures', () => {
    it('charges consumer VAT on EU B2C invoice (not 0%)', () => {
      const req: VendorInvoiceRequest = {
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2026-11-21',
        supplier: SUPPLIER_ROXIRA_MY, customer: CUSTOMER_EU_B2C, currency: Currency.EUR,
        items: [{ description: 'SaaS', quantity: 1, unitPriceMinor: 10000n }],
      };
      const doc = generator.generate(req, 1);
      expect(doc.lines[0].taxCode).toBe('EU-B2C-VAT');
      expect(doc.lines[0].taxRateDecimal).toBe('0.20');
      expect(doc.totalTaxMinor).toBe(2000n);
      expect(doc.reverseCharge).toBe(false);
    });

    it('produces valid Credit Note referencing original invoice for EU consumer refund', () => {
      const { sequenceNumber } = sequencer.nextNumber(EU_B2C_REFUND_REQUEST.series);
      const doc = generator.generate(EU_B2C_REFUND_REQUEST, sequenceNumber);

      expect(doc.documentType).toBe('CREDIT_NOTE');
      expect(doc.documentNumber).toBe('CN-2026-000001');
      expect(doc.totalNetMinor).toBe(4900n);
      expect(doc.totalTaxMinor).toBe(0n);
      expect(doc.relatedInvoice?.invoiceNumber).toBe('INV-2026-000003');

      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.subject).toBe(InvoiceSubject.RETURN);
      expect(ledgerDto.items[0].unitPrice).toBe(49);
    });
  });

  describe('4. Gapless Document Numbering, Replicas & Restart Persistence', () => {
    it('passes validation when documents are strictly consecutive and detects gaps/duplicates', () => {
      const doc1 = generator.generate(MY_B2B_INVOICE_REQUEST, 1);
      const doc2 = generator.generate(MY_B2B_INVOICE_REQUEST, 2);
      const doc3 = generator.generate(MY_B2B_INVOICE_REQUEST, 3);
      expect(() => GaplessNumberSequencer.validateGaplessSequence([doc1, doc2, doc3])).not.toThrow();

      expect(() => GaplessNumberSequencer.validateGaplessSequence([doc1, doc3])).toThrow(/Gap detected/);
      expect(() => GaplessNumberSequencer.validateGaplessSequence([doc1, doc1])).toThrow(/Duplicate sequence number/);
    });

    it('allocates non-duplicate sequence numbers across multiple replicas sharing storage', () => {
      const store = new MemorySequencerStore();
      const repA = new GaplessNumberSequencer(store);
      const repB = new GaplessNumberSequencer(store);

      expect(repA.nextNumber('INV-2026').sequenceNumber).toBe(1);
      expect(repB.nextNumber('INV-2026').sequenceNumber).toBe(2);
      expect(repA.nextNumber('INV-2026').sequenceNumber).toBe(3);
    });

    it('resumes numbering after server restart from persistent storage snapshot', () => {
      const store1 = new MemorySequencerStore();
      const seq1 = new GaplessNumberSequencer(store1);
      seq1.nextNumber('INV-2026');
      seq1.nextNumber('INV-2026');

      const store2 = new MemorySequencerStore();
      store2.importSnapshot(store1.exportSnapshot());
      const seq2 = new GaplessNumberSequencer(store2);
      expect(seq2.nextNumber('INV-2026').sequenceNumber).toBe(3);
    });

    it('issues the sequence number itself when sequenceNumber is omitted in generator', () => {
      const gen = new VendorInvoiceGenerator(registry, new GaplessNumberSequencer(new MemorySequencerStore()));
      expect(gen.generate(MY_B2B_INVOICE_REQUEST).sequenceNumber).toBe(1);
      expect(gen.generate(MY_B2B_INVOICE_REQUEST).sequenceNumber).toBe(2);
    });

    it('executes atomic Postgres row-locked counter query in PostgresSequencerStore', async () => {
      const mockManager = { query: jest.fn().mockResolvedValue([{ last_number: '42' }]) };
      const num = await new PostgresSequencerStore().nextNumber(
        { tenantId: '11111111-1111-1111-1111-111111111111', series: 'INV-2026' },
        mockManager,
      );
      expect(num).toBe(42);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT ("tenant_id", "document_type", "channel", "fiscal_year", "series")'),
        ['11111111-1111-1111-1111-111111111111', 'INVOICE', 'DEFAULT', 0, 'INV-2026'],
      );
    });
  });

  describe('5. Malaysia SST 6% and 8% Boundaries', () => {
    it('applies legacy 6% SST on 2024-02-29 and 8% SST on 2024-03-01 boundary', () => {
      const doc6 = generator.generate({ ...MY_B2B_INVOICE_REQUEST, issueDate: '2024-02-29' }, 1);
      expect(doc6.lines[0].taxRateDecimal).toBe('0.06');
      expect(doc6.lines[0].taxMinor).toBe(27000n);

      const doc8 = generator.generate({ ...MY_B2B_INVOICE_REQUEST, issueDate: '2024-03-01' }, 2);
      expect(doc8.lines[0].taxRateDecimal).toBe('0.08');
      expect(doc8.lines[0].taxMinor).toBe(36000n);
    });

    it('handles Malaysia B2C customer across 6% and 8% boundaries', () => {
      const b2cReq: VendorInvoiceRequest = {
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2024-03-01',
        supplier: SUPPLIER_ROXIRA_MY, customer: { ...CUSTOMER_MY_B2B, isB2B: false },
        currency: 'MYR' as Currency, items: [{ description: 'Cloud', quantity: 1, unitPriceMinor: 10000n }],
      };
      const doc = generator.generate(b2cReq, 1);
      expect(doc.lines[0].taxRateDecimal).toBe('0.08');
      expect(doc.lines[0].taxCode).toBe('MY-VT-GEN-B2C');
    });
  });

  describe('6. Fractional Quantities & Exact Scaling', () => {
    it('handles fractional quantity (0.5, 2.5) without throwing or float corruption', () => {
      const req: VendorInvoiceRequest = {
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2026-11-21',
        supplier: SUPPLIER_ROXIRA_MY, customer: CUSTOMER_MY_B2B, currency: 'MYR' as Currency,
        items: [
          { description: 'Consulting', quantity: 0.5, unitPriceMinor: 20000n },
          { description: 'Hosting', quantity: 2.5, unitPriceMinor: 1000n },
        ],
      };
      const doc = generator.generate(req, 1);
      expect(doc.lines[0].netMinor).toBe(10000n);
      expect(doc.lines[0].taxMinor).toBe(800n);
      expect(doc.lines[1].netMinor).toBe(2500n);
      expect(doc.lines[1].taxMinor).toBe(200n);
    });

    it('multiplyMinorByQuantity performs exact half-up rounding on fractional numbers', () => {
      expect(multiplyMinorByQuantity(1000n, 0.5)).toBe(500n);
      expect(multiplyMinorByQuantity(1000n, 2.5)).toBe(2500n);
      expect(multiplyMinorByQuantity(333n, 1)).toBe(333n);
    });
  });

  describe('7. Currency Exponents & FX Rounding (JPY 0 decimals, KWD 3 decimals)', () => {
    it('correctly handles JPY (0 decimals) to USD (2 decimals) exponent conversion', () => {
      expect(getCurrencyExponent('JPY')).toBe(0);
      expect(getCurrencyExponent('USD')).toBe(2);

      const doc = generator.generate({
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2026-11-21',
        supplier: SUPPLIER_ROXIRA_MY, customer: { name: 'Tokyo', country: 'JP', isB2B: true },
        currency: 'JPY' as Currency, items: [{ description: 'Office', quantity: 1, unitPriceMinor: 150000n }],
        fxRate: { baseCurrency: Currency.USD, rate: '0.006667' },
      }, 1);

      expect(doc.currency).toBe('JPY');
      expect(generator.toLedgerCreateInvoiceDto(doc).items[0].unitPrice).toBe(150000);
    });

    it('correctly handles KWD (3 decimals) to USD (2 decimals) exponent conversion', () => {
      expect(getCurrencyExponent('KWD')).toBe(3);

      const doc = generator.generate({
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2026-11-21',
        supplier: SUPPLIER_ROXIRA_MY, customer: { name: 'Kuwait', country: 'KW', isB2B: true },
        currency: 'KWD' as Currency, items: [{ description: 'License', quantity: 1, unitPriceMinor: 2500n }],
      }, 1);

      expect(generator.toLedgerCreateInvoiceDto(doc).items[0].unitPrice).toBe(2.5);
    });
  });

  describe('8. Non-EU/MY Export & Date Validation', () => {
    it('applies zero-rated export treatment for non-EU/MY international customers', () => {
      const doc = generator.generate({
        documentType: 'INVOICE', series: 'INV-2026', issueDate: '2026-11-21',
        supplier: SUPPLIER_ROXIRA_MY, customer: { name: 'Acme', country: 'US', isB2B: true },
        currency: Currency.USD, items: [{ description: 'Export', quantity: 1, unitPriceMinor: 50000n }],
      }, 1);

      expect(doc.lines[0].taxCode).toBe('EXPORT-ZERO');
      expect(doc.lines[0].taxRateDecimal).toBe('0.00');
      expect(doc.totalTaxMinor).toBe(0n);
      expect(doc.statutoryMentions).toContain('Zero-rated export of services outside taxing jurisdiction.');
    });

    it('rejects invalid or non-existent issue dates', () => {
      expect(() => generator.generate({ ...MY_B2B_INVOICE_REQUEST, issueDate: '2026-02-31' }, 1)).toThrow(/calendar date does not exist/);
      expect(() => generator.generate({ ...MY_B2B_INVOICE_REQUEST, issueDate: '2026/11/21' }, 1)).toThrow(BadRequestException);
    });
  });

  describe('9. PostgresSequencerStore & Persistent Numbering (T321)', () => {
    it('requires a valid non-zero tenantId and rejects empty or fallback zero UUID', async () => {
      const pgStore = new PostgresSequencerStore();
      const mockManager = { query: jest.fn() };

      await expect(
        pgStore.nextNumber({ series: 'INV-2026' }, mockManager),
      ).rejects.toThrow('Valid tenantId is required');

      await expect(
        pgStore.nextNumber(
          { tenantId: '00000000-0000-0000-0000-000000000000', series: 'INV-2026' },
          mockManager,
        ),
      ).rejects.toThrow('Valid tenantId is required');

      await expect(
        pgStore.nextNumber(
          { tenantId: 'not-a-uuid', series: 'INV-2026' },
          mockManager,
        ),
      ).rejects.toThrow('Valid tenantId is required');

      await expect(
        pgStore.nextNumber(
          { tenantId: '11111111-1111-4111-8111-111111111111', series: '   ' },
          mockManager,
        ),
      ).rejects.toThrow('Series is required');

      await expect(
        pgStore.nextNumber(
          { tenantId: '11111111-1111-4111-8111-111111111111', series: 'INV-2026' },
          {
            query: jest.fn(),
            queryRunner: { data: { appTenantId: '22222222-2222-4222-8222-222222222222' } },
          },
        ),
      ).rejects.toThrow('Tenant mismatch');
    });

    it('increments sequence atomically in Postgres using manager query', async () => {
      const pgStore = new PostgresSequencerStore();
      const mockManager = {
        query: jest.fn().mockResolvedValue([{ last_number: '42' }]),
      };

      const num = await pgStore.nextNumber(
        { tenantId: '11111111-1111-4111-8111-111111111111', series: 'INV-2026' },
        mockManager,
      );

      expect(num).toBe(42);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "fin_document_counters"'),
        ['11111111-1111-4111-8111-111111111111', 'INVOICE', 'DEFAULT', 0, 'INV-2026'],
      );
    });

    it('generates invoice asynchronously using generateAsync with Postgres sequencer', async () => {
      const pgStore = new PostgresSequencerStore();
      const pgSequencer = new GaplessNumberSequencer(pgStore);
      const pgGenerator = new VendorInvoiceGenerator(registry, pgSequencer);
      const mockManager = {
        query: jest.fn().mockResolvedValue([{ last_number: 10 }]),
      };

      const doc = await pgGenerator.generateAsync(
        {
          ...MY_B2B_INVOICE_REQUEST,
          tenantId: '11111111-1111-4111-8111-111111111111',
        },
        mockManager,
      );

      expect(doc.sequenceNumber).toBe(10);
      expect(doc.documentNumber).toBe('INV-2026-000010');
    });

    it('throws when generator has no sequencer and no sequenceNumber is passed', () => {
      const bareGenerator = new VendorInvoiceGenerator(registry);
      expect(() =>
        bareGenerator.generate({
          ...MY_B2B_INVOICE_REQUEST,
          tenantId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toThrow(/Explicit sequenceNumber or an injected sequencer is required/);
    });

    it('rejects unknown or invalid customer country code with 400', () => {
      expect(() =>
        generator.generate(
          {
            ...MY_B2B_INVOICE_REQUEST,
            customer: { ...CUSTOMER_MY_B2B, country: 'UNKNOWN_COUNTRY' },
          },
          1,
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects bare string series when sequencer uses PostgresSequencerStore', async () => {
      const pgSeq = new GaplessNumberSequencer(new PostgresSequencerStore());
      await expect(pgSeq.nextNumberAsync('INV')).rejects.toThrow(
        /PostgresSequencerStore requires full DocumentCounterKey with tenantId/,
      );
      expect(() => pgSeq.nextNumber('INV')).toThrow(
        /PostgresSequencerStore is an asynchronous store/,
      );
    });

    it('rejects sync generate() when PostgresSequencerStore is injected, directing to generateAsync', () => {
      const pgGen = new VendorInvoiceGenerator(
        registry,
        new GaplessNumberSequencer(new PostgresSequencerStore()),
      );
      expect(() =>
        pgGen.generate({
          ...MY_B2B_INVOICE_REQUEST,
          tenantId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toThrow(/Injected sequencer uses an asynchronous persistent store/);
    });

    it('handles multiplyMinorByQuantity with scientific notation without throwing', () => {
      // 1e-7 quantity: 0.0000001
      const resultSmall = multiplyMinorByQuantity(10000000n, 1e-7);
      expect(resultSmall).toBe(1n);

      // 1e-5 quantity: 0.00001
      const resultMedium = multiplyMinorByQuantity(500000n, 1e-5);
      expect(resultMedium).toBe(5n);
    });

    it('minorToExactMajorString formats minor units exactly without float division', () => {
      // Normal numbers
      expect(minorToExactMajorString(450000n, 2)).toBe('4500');
      expect(minorToExactMajorString(450050n, 2)).toBe('4500.5');
      expect(minorToExactMajorString(450055n, 2)).toBe('4500.55');
      expect(minorToExactMajorString(150000n, 0)).toBe('150000');
      expect(minorToExactMajorString(2500n, 3)).toBe('2.5');

      // Extreme values > 2^53 (e.g. 10^16 minor units)
      const hugeMinor = 10_000_000_000_000_000n;
      expect(minorToExactMajorString(hugeMinor, 2)).toBe('100000000000000');
      expect(minorToExactMajorString(hugeMinor + 55n, 2)).toBe('100000000000000.55');
    });

    it('toLedgerCreateInvoiceDto guards against amounts exceeding IEEE 754 safe integer limit', () => {
      const hugeDoc = generator.generate({
        ...MY_B2B_INVOICE_REQUEST,
        items: [{ description: 'Exceeding', quantity: 1, unitPriceMinor: 10_000_000_000_000_000n }],
      }, 1);
      expect(() => generator.toLedgerCreateInvoiceDto(hugeDoc)).toThrow(BadRequestException);
      expect(() => generator.toLedgerCreateInvoiceDto(hugeDoc)).toThrow(/exceed IEEE 754 safe integer limit/);
    });

    it('correctly resolves currency exponents for standard ISO, 0-decimal, 3-decimal, and IRT', () => {
      expect(getCurrencyExponent('IRT')).toBe(0);
      expect(getCurrencyExponent('IRR')).toBe(0);
      expect(getCurrencyExponent('CLP')).toBe(0);
      expect(getCurrencyExponent('JOD')).toBe(3);
      expect(getCurrencyExponent('KWD')).toBe(3);
      expect(getCurrencyExponent('EUR')).toBe(2);
      expect(getCurrencyExponent('USD')).toBe(2);
      expect(EU_MEMBER_COUNTRIES.has('DE')).toBe(true);
      expect(EU_MEMBER_COUNTRIES.has('US')).toBe(false);
    });
  });
});
