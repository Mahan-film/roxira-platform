import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import {
  EInvoiceType,
  InvoiceDirection,
  InvoiceSubject,
} from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import {
  invoiceRateLines,
  invoiceRialAmounts,
  rialMinor,
} from './invoice-rial-amounts';

function createInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  const base: InvoiceEntity = {
    id: 'invoice-1',
    tenantId: 'tenant-1',
    taxInvoiceNumber: 'INV-1',
    customerId: null,
    sellerInfo: { name: 'Seller' },
    buyerInfo: { name: 'Buyer' },
    items: [],
    currency: Currency.IRR,
    jurisdiction: InvoiceJurisdiction.IR,
    exchangeRate: 1,
    fxRate: 1,
    amountFx: null,
    baseCurrency: Currency.USD,
    totalAmount: 0,
    totalDiscount: 0,
    totalTax: 0,
    finalPayable: 0,
    baseTotalAmount: 0,
    baseTotalTax: 0,
    baseFinalPayable: 0,
    status: InvoiceStatus.DRAFT,
    issuedAt: null,
    paidAt: null,
    journalEntryId: null,
    paidJournalEntryId: null,
    reversalJournalEntryId: null,
    postingError: null,
    direction: InvoiceDirection.SALE,
    einvoiceType: EInvoiceType.WITH_BUYER,
    subject: InvoiceSubject.ORIGINAL,
    relatedInvoiceId: null,
    warehouseId: null,
    postingMeta: null,
    idempotencyKey: null,
    requestHash: null,
    payments: null,
    createdAt: new Date(0),
  };
  return { ...base, ...overrides };
}

describe('invoice-rial-amounts', () => {
  describe('rialMinor', () => {
    it('converts an IRR amount at rate 1 to rial minor units', () => {
      const invoice = createInvoice();
      expect(rialMinor(invoice, 1000)).toBe(100000n);
    });

    it('converts a foreign-currency amount using fxRate', () => {
      const invoice = createInvoice({ currency: Currency.USD, fxRate: 50000 });
      expect(rialMinor(invoice, 100)).toBe(500000000n);
    });

    it('falls back to rate 1 when fxRate is missing', () => {
      const invoice = createInvoice({ currency: Currency.USD, fxRate: undefined });
      expect(rialMinor(invoice, 100)).toBe(10000n);
    });

    it('falls back to rate 1 when fxRate is not positive', () => {
      const invoice = createInvoice({ currency: Currency.USD, fxRate: 0 });
      expect(rialMinor(invoice, 100)).toBe(10000n);
    });

    it('rounds a positive half case up', () => {
      const invoice = createInvoice({ fxRate: 1.5 });
      // 0.01 * 1.5 = 0.015 rial -> 1.5 minor -> rounds to 2.
      expect(rialMinor(invoice, 0.01)).toBe(2n);
    });

    it('rounds a negative half case away from zero', () => {
      const invoice = createInvoice({ fxRate: 1.5 });
      expect(rialMinor(invoice, -0.01)).toBe(-2n);
    });

    it('treats null and undefined amounts as zero', () => {
      const invoice = createInvoice();
      expect(rialMinor(invoice, null)).toBe(0n);
      expect(rialMinor(invoice, undefined)).toBe(0n);
    });
  });

  describe('invoiceRialAmounts', () => {
    it('computes receivable, VAT and the sales plug', () => {
      const invoice = createInvoice({ finalPayable: 1000, totalTax: 100 });
      expect(invoiceRialAmounts(invoice)).toEqual({
        receivableMinor: 100000n,
        vatMinor: 10000n,
        salesMinor: 90000n,
      });
    });
  });

  describe('invoiceRateLines', () => {
    it('reconciles line base to the invoice sales plug', () => {
      const invoice = createInvoice({
        finalPayable: 1000,
        totalTax: 100,
        items: [
          {
            description: 'Item 1',
            quantity: 2,
            unitPrice: 500,
            discount: 0,
            vatRate: 0.1,
            tax: 100,
            total: 1000,
          },
        ],
      });
      const lines = invoiceRateLines(invoice, invoiceRialAmounts(invoice));
      expect(lines).toHaveLength(1);
      expect(lines[0].baseMinor).toBe(90000n);
      expect(lines[0].vatMinor).toBe(10000n);
    });
  });
});
