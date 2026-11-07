import {
  invoicePostingTotals,
  matchInvoice,
  matchInvoiceLine,
  InvoiceLineFacts,
} from './invoice-match.domain';
import { lineValue } from './purchase-order.domain';

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

/**
 * Quantity allowance (#585) and a pinned price-tolerance scenario.
 *
 * quantity is in hundredths of a unit and unitPrice in minor units per whole unit, so lineValue is
 * `(quantity * unitPrice + 50) / 100` (half up). In the price scenario below the order is 100.00
 * units at 1000, i.e. (10000 * 1000) / 100 = 100,000 minor units.
 */
describe('invoice match tolerances (#585)', () => {
  const qtyFacts = (overrides: Partial<InvoiceLineFacts> = {}): InvoiceLineFacts => ({
    orderUnitPrice: 1000n,
    receivedQuantity: 10000n,
    alreadyInvoicedQuantity: 0n,
    quantity: 10000n,
    unitPrice: 1000n,
    ...overrides,
  });

  it('allows a quantity excess inside the allowance and flags one beyond it', () => {
    // received 100.00; invoiced 103.00 -> excess 300 hundredths.
    const invoiced = qtyFacts({ quantity: 10300n });

    expect(
      matchInvoiceLine(invoiced, { priceToleranceBp: 0, priceToleranceAbs: 0n, qtyExcessToleranceBp: 0 }).status,
    ).toBe('QTY_MISMATCH');

    // allowed = 10000 * 300 / 10000 = 300; 300 > 300 is false.
    expect(
      matchInvoiceLine(invoiced, { priceToleranceBp: 0, priceToleranceAbs: 0n, qtyExcessToleranceBp: 300 }).status,
    ).toBe('MATCHED');

    // allowed = 2,990,000 / 10,000 = 299 (floor); 300 > 299.
    expect(
      matchInvoiceLine(invoiced, { priceToleranceBp: 0, priceToleranceAbs: 0n, qtyExcessToleranceBp: 299 }).status,
    ).toBe('QTY_MISMATCH');
  });

  it('keeps the real excess in the result even when the quantity is inside tolerance', () => {
    // received 100.00; invoiced 106.00 -> excess 600 hundredths; allowed = 10000 * 500 / 10000 = 500.
    const result = matchInvoiceLine(qtyFacts({ quantity: 10600n }), {
      priceToleranceBp: 0,
      priceToleranceAbs: 0n,
      qtyExcessToleranceBp: 500,
    });
    expect(result.status).toBe('QTY_MISMATCH');
    expect(result.qtyExcess).toBe(600n);
  });

  it('pins the price tolerance: 100.00 at 1000 gives order value 100,000 and allowed 5,000 at 500 bp', () => {
    const orderValue = 100_000n;
    expect(lineValue(qtyFacts().quantity, qtyFacts().orderUnitPrice)).toBe(orderValue);
    const tolerance = { priceToleranceBp: 500, priceToleranceAbs: 0n };

    // 1050 -> (10000 * 1050) / 100 = 105,000; diff 5,000 == allowed.
    const inside = matchInvoiceLine(qtyFacts({ unitPrice: 1050n }), tolerance);
    expect(inside.priceDifference).toBe(5_000n);
    expect(inside.status).toBe('MATCHED');

    // 1051 -> (10000 * 1051) / 100 = 105,100; diff 5,100 > 5,000.
    const outside = matchInvoiceLine(qtyFacts({ unitPrice: 1051n }), tolerance);
    expect(outside.priceDifference).toBe(5_100n);
    expect(outside.status).toBe('PRICE_MISMATCH');
  });
});
