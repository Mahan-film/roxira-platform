import {
  invoicePostingTotals,
  matchInvoice,
  matchInvoiceLine,
  InvoiceLineFacts,
} from './invoice-match.domain';

const facts = (overrides: Partial<InvoiceLineFacts> = {}): InvoiceLineFacts => ({
  orderUnitPrice: 5_000_000n,
  receivedQuantity: 1000n,
  alreadyInvoicedQuantity: 0n,
  quantity: 1000n,
  unitPrice: 5_000_000n,
  ...overrides,
});

describe('invoice match domain (#227 T2)', () => {
  it('matches an invoice at the PO price with no difference', () => {
    expect(matchInvoiceLine(facts(), { priceToleranceBp: 0, priceToleranceAbs: 0n })).toEqual({
      status: 'MATCHED',
      qtyExcess: 0n,
      orderValue: 50_000_000n,
      invoiceValue: 50_000_000n,
      priceDifference: 0n,
    });
  });

  it('holds a higher price above the percentage tolerance and accepts it inside', () => {
    const higher = facts({ unitPrice: 5_100_000n });
    expect(
      matchInvoiceLine(higher, { priceToleranceBp: 0, priceToleranceAbs: 0n }),
    ).toMatchObject({ invoiceValue: 51_000_000n, orderValue: 50_000_000n, priceDifference: 1_000_000n });

    expect(
      matchInvoiceLine(higher, { priceToleranceBp: 100, priceToleranceAbs: 0n }).status,
    ).toBe('PRICE_MISMATCH');

    expect(
      matchInvoiceLine(higher, { priceToleranceBp: 100, priceToleranceAbs: 1_000_000n }).status,
    ).toBe('MATCHED');

    expect(
      matchInvoiceLine(higher, { priceToleranceBp: 200, priceToleranceAbs: 0n }).status,
    ).toBe('MATCHED');

    expect(
      matchInvoiceLine(higher, { priceToleranceBp: 199, priceToleranceAbs: 0n }).status,
    ).toBe('PRICE_MISMATCH');
  });

  it('treats the larger of percentage and absolute tolerance as the allowance', () => {
    const lower = facts({ unitPrice: 4_900_000n });
    expect(
      matchInvoiceLine(lower, { priceToleranceBp: 0, priceToleranceAbs: 0n }),
    ).toMatchObject({ priceDifference: -1_000_000n, status: 'PRICE_MISMATCH' });
  });

  it('holds an invoice quantity beyond what was received and reports the excess', () => {
    expect(
      matchInvoiceLine(facts({ quantity: 1100n }), { priceToleranceBp: 0, priceToleranceAbs: 0n }),
    ).toMatchObject({ status: 'QTY_MISMATCH', qtyExcess: 100n });
  });

  it('counts what other invoices already charged to the same receipt line', () => {
    expect(
      matchInvoiceLine(facts({ receivedQuantity: 600n, alreadyInvoicedQuantity: 400n, quantity: 300n }), {
        priceToleranceBp: 0,
        priceToleranceAbs: 0n,
      }),
    ).toMatchObject({ status: 'QTY_MISMATCH', qtyExcess: 100n });

    expect(
      matchInvoiceLine(facts({ receivedQuantity: 600n, alreadyInvoicedQuantity: 400n, quantity: 200n }), {
        priceToleranceBp: 0,
        priceToleranceAbs: 0n,
      }).status,
    ).toBe('MATCHED');
  });

  it('reports both problems when quantity and price are out of tolerance', () => {
    expect(
      matchInvoiceLine(facts({ quantity: 1100n, unitPrice: 5_100_000n }), {
        priceToleranceBp: 0,
        priceToleranceAbs: 0n,
      }),
    ).toMatchObject({ status: 'QTY_AND_PRICE_MISMATCH', qtyExcess: 100n, priceDifference: 1_100_000n });
  });

  it('holds the invoice when any line mismatched', () => {
    expect(matchInvoice([{ status: 'MATCHED' }, { status: 'MATCHED' }])).toBe('MATCHED');
    expect(matchInvoice([{ status: 'MATCHED' }, { status: 'QTY_MISMATCH' }])).toBe('HELD');
  });

  it('posts GRNI at the PO price, the signed variance, VAT and the payable', () => {
    const line = matchInvoiceLine(facts({ unitPrice: 5_100_000n }), {
      priceToleranceBp: 0,
      priceToleranceAbs: 0n,
    });
    expect(invoicePostingTotals([line], 4_590_000n)).toEqual({
      grniDebit: 50_000_000n,
      varianceNet: 1_000_000n,
      vat: 4_590_000n,
      payable: 55_590_000n,
    });

    const cheaper = matchInvoiceLine(facts({ unitPrice: 4_900_000n }), {
      priceToleranceBp: 0,
      priceToleranceAbs: 0n,
    });
    expect(invoicePostingTotals([cheaper], 0n)).toEqual({
      grniDebit: 50_000_000n,
      varianceNet: -1_000_000n,
      vat: 0n,
      payable: 49_000_000n,
    });
  });
});