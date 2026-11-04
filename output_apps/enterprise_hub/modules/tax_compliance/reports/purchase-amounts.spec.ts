import { purchaseFromCapture, purchaseFromInvoice } from './purchase-amounts';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { CaptureDocumentEntity } from '../../invoice_capture/entities/capture.entities';

/**
 * Only the fields read by `purchase-amounts.ts` matter to these tests; everything else is
 * DB-managed, so the fixtures are minimal and cast through `unknown`.
 */
const asInvoice = (partial: Record<string, unknown>): InvoiceEntity =>
  partial as unknown as InvoiceEntity;

const asCaptureDoc = (docDraft: Record<string, unknown>): CaptureDocumentEntity =>
  ({ extracted: { draft: docDraft }, edited: null } as unknown as CaptureDocumentEntity);

/** A complete, readable purchase draft; override the fields each case cares about. */
const draft = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'purchase',
  sellerName: 'Test Seller',
  sellerTaxId: '1234567890',
  buyerName: 'Test Buyer',
  buyerTaxId: '',
  invoiceNumber: 'CAP123',
  date: '2023-01-01',
  currency: 'IRR',
  fxRate: null,
  items: [{ total: '1000.00' }],
  subtotal: '1000.00',
  tax: '100.00',
  total: '1100.00',
  paid: false,
  notes: '',
  ...overrides,
});

describe('purchaseFromInvoice', () => {
  it('converts a purchase invoice to whole-rial minor units', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: 'INV123',
      sellerInfo: { name: 'Test Seller', nationalId: '1234567890' },
      finalPayable: 1000,
      totalTax: 100,
      fxRate: 1,
    });

    const result = purchaseFromInvoice(invoice, '2023-01-01');

    expect(result).toEqual({
      source: 'invoice',
      documentNumber: 'INV123',
      date: '2023-01-01',
      sellerName: 'Test Seller',
      sellerTaxId: '1234567890',
      baseMinor: 90000n, // sales = payable 1000.00 - vat 100.00
      vatMinor: 10000n,
    });
  });

  it('keeps zero unchanged', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: 'INV000',
      sellerInfo: { name: 'Zero Seller', nationalId: '0000000000' },
      finalPayable: 0,
      totalTax: 0,
      fxRate: 1,
    });

    const result = purchaseFromInvoice(invoice, '2023-01-01');

    expect(result.baseMinor).toBe(0n);
    expect(result.vatMinor).toBe(0n);
  });

  it('carries the sign of a credit note through', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: 'INV-1',
      sellerInfo: { name: 'Credit Seller', nationalId: '9999999999' },
      finalPayable: -500,
      totalTax: -50,
      fxRate: 1,
    });

    const result = purchaseFromInvoice(invoice, '2023-01-01');

    // sales = -500.00 - (-50.00) = -450.00
    expect(result.baseMinor).toBe(-45000n);
    expect(result.vatMinor).toBe(-5000n);
  });

  it('rounds each amount to the cent before applying the rate', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: 'INVROUND',
      sellerInfo: { name: 'Round Seller', nationalId: '1111111111' },
      finalPayable: 1000.999,
      totalTax: 100.999,
      fxRate: 1,
    });

    const result = purchaseFromInvoice(invoice, '2023-01-01');

    // 1000.999 -> 1001.00 and 100.999 -> 101.00, so sales = 900.00.
    expect(result.baseMinor).toBe(90000n);
    expect(result.vatMinor).toBe(10100n);
  });

  it('applies the fx rate to payable and vat', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: 'INVFX',
      sellerInfo: { name: 'Fx Seller', nationalId: '2222222222' },
      finalPayable: 1000,
      totalTax: 100,
      fxRate: 2,
    });

    const result = purchaseFromInvoice(invoice, '2024-05-05');

    expect(result.baseMinor).toBe(180000n); // 200000 - 20000
    expect(result.vatMinor).toBe(20000n);
  });

  it('falls back to empty strings and zero for missing fields', () => {
    const invoice = asInvoice({
      taxInvoiceNumber: null,
      sellerInfo: null,
      finalPayable: null,
      totalTax: null,
      fxRate: 1,
    });

    const result = purchaseFromInvoice(invoice, '2023-01-01');

    expect(result.documentNumber).toBe('');
    expect(result.sellerName).toBe('');
    expect(result.sellerTaxId).toBe('');
    expect(result.baseMinor).toBe(0n);
    expect(result.vatMinor).toBe(0n);
  });
});

describe('purchaseFromCapture', () => {
  it('sums item totals and converts the tax for an IRR purchase', () => {
    const result = purchaseFromCapture(asCaptureDoc(draft()));

    expect(result).toEqual({
      source: 'capture',
      documentNumber: 'CAP123',
      date: '2023-01-01',
      sellerName: 'Test Seller',
      sellerTaxId: '1234567890',
      baseMinor: 100000n, // item total 1000.00
      vatMinor: 10000n, // tax 100.00
    });
  });

  it('sums several item totals exactly', () => {
    const doc = asCaptureDoc(
      draft({ items: [{ total: '1000.00' }, { total: '250.50' }], tax: '125.05' }),
    );

    const result = purchaseFromCapture(doc);

    expect(result?.baseMinor).toBe(125050n);
    expect(result?.vatMinor).toBe(12505n);
  });

  it('keeps zero unchanged', () => {
    const doc = asCaptureDoc(draft({ items: [{ total: '0.00' }], tax: '0.00' }));

    const result = purchaseFromCapture(doc);

    expect(result?.baseMinor).toBe(0n);
    expect(result?.vatMinor).toBe(0n);
  });

  it('converts a non-IRR draft at its fx rate', () => {
    const doc = asCaptureDoc(
      draft({ currency: 'USD', fxRate: '500.000000', items: [{ total: '1000.00' }], tax: '100.00' }),
    );

    const result = purchaseFromCapture(doc);

    // 1000.00 USD at 500 -> 500000.00 IRR; tax 100.00 USD -> 50000.00 IRR.
    expect(result?.baseMinor).toBe(50000000n);
    expect(result?.vatMinor).toBe(5000000n);
  });

  it('returns null for a negative (credit) item, which the parser rejects', () => {
    const doc = asCaptureDoc(
      draft({ items: [{ total: '-500.00' }], tax: '-50.00' }),
    );

    expect(purchaseFromCapture(doc)).toBeNull();
  });

  it('returns null when an amount has more than two decimals', () => {
    const doc = asCaptureDoc(
      draft({ items: [{ total: '1000.999' }], tax: '100.999' }),
    );

    expect(purchaseFromCapture(doc)).toBeNull();
  });

  it('returns null when an amount is not a plain number', () => {
    const doc = asCaptureDoc(draft({ items: [{ total: 'invalid' }], tax: 'invalid' }));

    expect(purchaseFromCapture(doc)).toBeNull();
  });

  it('returns null when the draft has no readable date', () => {
    const doc = asCaptureDoc(draft({ date: null }));

    expect(purchaseFromCapture(doc)).toBeNull();
  });

  it('returns null when a non-IRR draft has no fx rate', () => {
    const doc = asCaptureDoc(draft({ currency: 'USD', fxRate: null }));

    expect(purchaseFromCapture(doc)).toBeNull();
  });

  it('prefers the edited draft over the extracted one', () => {
    const doc = {
      extracted: { draft: draft({ invoiceNumber: 'STALE', items: [{ total: '1.00' }] }) },
      edited: draft({ invoiceNumber: 'EDITED', items: [{ total: '2000.00' }], tax: '200.00' }),
    } as unknown as CaptureDocumentEntity;

    const result = purchaseFromCapture(doc);

    expect(result?.documentNumber).toBe('EDITED');
    expect(result?.baseMinor).toBe(200000n);
    expect(result?.vatMinor).toBe(20000n);
  });
});
