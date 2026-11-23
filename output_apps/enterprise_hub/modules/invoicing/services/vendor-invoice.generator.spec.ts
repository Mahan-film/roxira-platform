import { BadRequestException } from '@nestjs/common';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceJurisdiction } from '../enums/invoice-jurisdiction.enum';
import {
  EffectiveTaxTreatmentRegistry,
  GaplessNumberSequencer,
  VendorInvoiceGenerator,
  VendorInvoiceDocument,
} from './vendor-invoice.generator';
import {
  MY_B2B_INVOICE_REQUEST,
  EU_B2B_INVOICE_REQUEST,
  EU_B2C_REFUND_REQUEST,
} from '../__fixtures__/vendor-invoice.fixture';

describe('VendorInvoiceGenerator (T321 / R31)', () => {
  let registry: EffectiveTaxTreatmentRegistry;
  let sequencer: GaplessNumberSequencer;
  let generator: VendorInvoiceGenerator;

  beforeEach(() => {
    registry = new EffectiveTaxTreatmentRegistry();
    sequencer = new GaplessNumberSequencer();
    generator = new VendorInvoiceGenerator(registry);
  });

  describe('1. MY B2B Invoice Fixture', () => {
    it('produces valid Malaysian B2B invoice with gapless numbering and effective 8% SST line', () => {
      const { sequenceNumber } = sequencer.nextNumber(MY_B2B_INVOICE_REQUEST.series);
      expect(sequenceNumber).toBe(1);

      const doc = generator.generate(MY_B2B_INVOICE_REQUEST, sequenceNumber);

      expect(doc.documentType).toBe('INVOICE');
      expect(doc.documentNumber).toBe('INV-2026-000001');
      expect(doc.sequenceNumber).toBe(1);
      expect(doc.issueDate).toBe('2026-11-21');
      expect(doc.currency).toBe('MYR');

      // Net lines:
      // Line 1: 1 * 450,000 = 450,000 minor units (RM 4,500.00)
      // Line 2: 2 * 50,000 = 100,000 minor units (RM 1,000.00)
      // Total net: 550,000 minor units (RM 5,500.00)
      expect(doc.totalNetMinor).toBe(550000n);

      // Effective SST rate on 2026-11-21 is 8% (800 bps)
      expect(doc.lines[0].taxRateDecimal).toBe('0.08');
      expect(doc.lines[0].taxCode).toBe('MY-VT-GEN');
      expect(doc.lines[0].taxMinor).toBe(36000n); // (450000 * 800) / 10000 = 36000
      expect(doc.lines[0].grossMinor).toBe(486000n);

      expect(doc.lines[1].taxRateDecimal).toBe('0.08');
      expect(doc.lines[1].taxMinor).toBe(8000n); // (100000 * 800) / 10000 = 8000
      expect(doc.lines[1].grossMinor).toBe(108000n);

      // Total tax: 44,000 minor units (RM 440.00)
      // Total gross: 594,000 minor units (RM 5,940.00)
      expect(doc.totalTaxMinor).toBe(44000n);
      expect(doc.totalGrossMinor).toBe(594000n);
      expect(doc.reverseCharge).toBe(false);

      // Statutory mention must include the Service Tax 8% statement
      expect(doc.statutoryMentions).toContain(
        'Service Tax (SST) 8% applicable under the Service Tax Act 2018.',
      );

      // Supplier and customer info:
      expect(doc.supplier.name).toBe('Roxira Technologies Sdn. Bhd.');
      expect(doc.supplier.taxId).toBe('W10-2401-32000042');
      expect(doc.customer.name).toBe('Pelangi Media Berhad');
      expect(doc.customer.taxId).toBe('B10-1808-11000011');

      // Converts cleanly to Roxira CreateInvoiceDto for ledger integration
      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.taxInvoiceNumber).toBe('INV-2026-000001');
      expect(ledgerDto.direction).toBe(InvoiceDirection.SALE);
      expect(ledgerDto.jurisdiction).toBe(InvoiceJurisdiction.INTL);
      expect(ledgerDto.subject).toBe(InvoiceSubject.ORIGINAL);
      expect(ledgerDto.items).toHaveLength(2);
      expect(ledgerDto.items[0].vatRate).toBe(0.08);
    });
  });

  describe('2. EU B2B Invoice Fixture', () => {
    it('produces valid EU B2B cross-border invoice with reverse-charge mention and FX rate', () => {
      const { sequenceNumber } = sequencer.nextNumber(EU_B2B_INVOICE_REQUEST.series);
      expect(sequenceNumber).toBe(1);

      const doc = generator.generate(EU_B2B_INVOICE_REQUEST, sequenceNumber);

      expect(doc.documentType).toBe('INVOICE');
      expect(doc.documentNumber).toBe('INV-2026-000001');
      expect(doc.currency).toBe(Currency.EUR);

      // Line: 5 * 20,000 = 100,000 minor units (EUR 1,000.00)
      expect(doc.totalNetMinor).toBe(100000n);
      expect(doc.totalTaxMinor).toBe(0n);
      expect(doc.totalGrossMinor).toBe(100000n);
      expect(doc.reverseCharge).toBe(true);

      // Mandatory EU Article 196 reverse-charge mention
      expect(doc.statutoryMentions).toContain(
        'Reverse charge: Customer to account for VAT under Article 196 of Council Directive 2006/112/EC.',
      );

      // FX rate to base currency USD
      expect(doc.fxRate).toBeDefined();
      expect(doc.fxRate?.baseCurrency).toBe(Currency.USD);
      expect(doc.fxRate?.rate).toBe('1.085000');
      expect(doc.statutoryMentions.some((m) => m.includes('Exchange rate'))).toBe(true);

      // Customer verified VAT ID
      expect(doc.customer.taxId).toBe('DE312456789');
      expect(doc.customer.verifiedTaxId).toBe(true);

      // Converts cleanly to Roxira CreateInvoiceDto for ledger integration
      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.fxRate).toBe(1.085);
      expect(ledgerDto.items[0].vatRate).toBe(0);
    });
  });

  describe('3. EU B2C Refund / Credit Note Fixture', () => {
    it('produces valid Credit Note referencing original invoice for EU consumer refund', () => {
      const { sequenceNumber } = sequencer.nextNumber(EU_B2C_REFUND_REQUEST.series);
      expect(sequenceNumber).toBe(1);

      const doc = generator.generate(EU_B2C_REFUND_REQUEST, sequenceNumber);

      expect(doc.documentType).toBe('CREDIT_NOTE');
      expect(doc.documentNumber).toBe('CN-2026-000001');
      expect(doc.series).toBe('CN-2026');
      expect(doc.currency).toBe(Currency.EUR);

      // Line: 1 * 4,900 = 4,900 minor units (EUR 49.00)
      expect(doc.totalNetMinor).toBe(4900n);
      expect(doc.totalTaxMinor).toBe(0n);
      expect(doc.totalGrossMinor).toBe(4900n);

      // Related invoice reference
      expect(doc.relatedInvoice).toBeDefined();
      expect(doc.relatedInvoice?.invoiceNumber).toBe('INV-2026-000003');
      expect(doc.relatedInvoice?.issueDate).toBe('2026-11-15');

      // Statutory mentions must reference original invoice and credit note reason
      expect(doc.statutoryMentions.some((m) => m.includes('INV-2026-000003'))).toBe(true);
      expect(doc.statutoryMentions.some((m) => m.includes('Credit Note'))).toBe(true);

      // Converts to ledger DTO with subject RETURN
      const ledgerDto = generator.toLedgerCreateInvoiceDto(doc);
      expect(ledgerDto.subject).toBe(InvoiceSubject.RETURN);
      expect(ledgerDto.taxInvoiceNumber).toBe('CN-2026-000001');
    });

    it('rejects credit note without related invoice reference', () => {
      const invalidRequest = {
        ...EU_B2C_REFUND_REQUEST,
        relatedInvoice: undefined,
      };
      expect(() => generator.generate(invalidRequest, 1)).toThrow(BadRequestException);
    });
  });

  describe('4. Gapless Document Numbering Validation', () => {
    it('passes validation when documents are strictly consecutive with no gaps', () => {
      const doc1 = generator.generate(MY_B2B_INVOICE_REQUEST, 1);
      const doc2 = generator.generate(MY_B2B_INVOICE_REQUEST, 2);
      const doc3 = generator.generate(MY_B2B_INVOICE_REQUEST, 3);

      expect(() => {
        GaplessNumberSequencer.validateGaplessSequence([doc1, doc2, doc3]);
      }).not.toThrow();
    });

    it('detects and rejects gaps in sequence numbers', () => {
      const doc1 = generator.generate(MY_B2B_INVOICE_REQUEST, 1);
      const doc3 = generator.generate(MY_B2B_INVOICE_REQUEST, 3); // Missing 2

      expect(() => {
        GaplessNumberSequencer.validateGaplessSequence([doc1, doc3]);
      }).toThrow(BadRequestException);
      expect(() => {
        GaplessNumberSequencer.validateGaplessSequence([doc1, doc3]);
      }).toThrow(/Gap detected/);
    });

    it('detects and rejects duplicate sequence numbers', () => {
      const doc1 = generator.generate(MY_B2B_INVOICE_REQUEST, 1);
      const doc1Duplicate = generator.generate(MY_B2B_INVOICE_REQUEST, 1);

      expect(() => {
        GaplessNumberSequencer.validateGaplessSequence([doc1, doc1Duplicate]);
      }).toThrow(BadRequestException);
      expect(() => {
        GaplessNumberSequencer.validateGaplessSequence([doc1, doc1Duplicate]);
      }).toThrow(/Duplicate sequence number/);
    });
  });

  describe('5. Effective-Dated Statutory Config', () => {
    it('applies legacy 6% SST for dates before 2024-03-01', () => {
      const legacyRequest = {
        ...MY_B2B_INVOICE_REQUEST,
        issueDate: '2023-12-15',
      };
      const doc = generator.generate(legacyRequest, 1);

      expect(doc.lines[0].taxRateDecimal).toBe('0.06');
      expect(doc.lines[0].taxCode).toBe('MY-VT-LEGACY');
      // 450,000 * 6% = 27,000
      expect(doc.lines[0].taxMinor).toBe(27000n);
      // 100,000 * 6% = 6,000
      expect(doc.lines[1].taxMinor).toBe(6000n);
      expect(doc.totalTaxMinor).toBe(33000n);
    });

    it('allows dynamic registration of custom effective-dated tax treatments without hardcoding', () => {
      registry.registerRule({
        jurisdiction: 'SG',
        customerType: 'B2B',
        taxCode: 'SG-GST-9',
        taxName: 'Singapore Goods & Services Tax (GST)',
        rateBps: 900,
        rateDecimal: '0.09',
        isReverseCharge: false,
        mandatoryMention: 'GST 9% charged under Singapore GST Act.',
        effectiveFrom: '2024-01-01',
        sourceUrl: 'https://www.iras.gov.sg',
        verified: true,
      });

      const sgRequest = {
        ...MY_B2B_INVOICE_REQUEST,
        customer: {
          ...MY_B2B_INVOICE_REQUEST.customer,
          country: 'SG',
        },
        issueDate: '2026-11-21',
      };

      const doc = generator.generate(sgRequest, 1);
      expect(doc.lines[0].taxRateDecimal).toBe('0.09');
      expect(doc.lines[0].taxCode).toBe('SG-GST-9');
      // 550,000 * 9% = 49,500
      expect(doc.totalTaxMinor).toBe(49500n);
      expect(doc.statutoryMentions).toContain('GST 9% charged under Singapore GST Act.');
    });
  });
});
