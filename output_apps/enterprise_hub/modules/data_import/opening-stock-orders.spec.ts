import { BadRequestException } from '@nestjs/common';
import {
  buildOpeningStockLayers,
  importOpenOrders,
} from './analysis/opening-stock-orders';

describe('Opening stock layers & open PO/SO import (T328 / #1151)', () => {
  it('builds one layer per batch and matches TB inventory valuation', () => {
    const result = buildOpeningStockLayers({
      mode: 'BATCH',
      trialBalanceInventoryMinor: 15_000_000n,
      requireTbMatch: true,
      items: [
        { sku: 'SKU-1', batchNumber: 'B-01', quantity: '10', unitCostMinor: 1_000_000n },
        { sku: 'SKU-1', batchNumber: 'B-02', quantity: '5', unitCostMinor: 1_000_000n },
      ],
    });

    expect(result.balanced).toBe(true);
    expect(result.varianceMinor).toBe(0n);
    expect(result.totalInventoryMinor).toBe(15_000_000n);
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]).toMatchObject({
      sku: 'SKU-1',
      batchNumber: 'B-01',
      mode: 'BATCH',
      totalValueMinor: 10_000_000n,
    });
  });

  it('collapses batches into one average layer with note and preserves exact TB value', () => {
    const result = buildOpeningStockLayers({
      mode: 'AVERAGE',
      trialBalanceInventoryMinor: 16_000_000n,
      requireTbMatch: true,
      items: [
        { sku: 'SKU-2', batchNumber: 'B-01', quantity: '10', unitCostMinor: 1_000_000n },
        { sku: 'SKU-2', batchNumber: 'B-02', quantity: '5', unitCostMinor: 1_200_000n },
      ],
    });

    expect(result.balanced).toBe(true);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({
      sku: 'SKU-2',
      batchNumber: 'OPENING-AVG',
      quantity: '15',
      totalValueMinor: 16_000_000n,
      mode: 'AVERAGE',
    });
    expect(result.layers[0].note).toContain('2 دسته');
  });

  it('rejects opening stock when inventory value differs from TB and requireTbMatch is set', () => {
    expect(() =>
      buildOpeningStockLayers({
        mode: 'BATCH',
        trialBalanceInventoryMinor: 99_000_000n,
        requireTbMatch: true,
        items: [{ sku: 'SKU-1', quantity: '10', unitCostMinor: 1_000_000n }],
      }),
    ).toThrow(BadRequestException);
  });

  it('imports partial POs keeping the received part and partly shipped SOs with customer deposits', () => {
    const imported = importOpenOrders([
      {
        orderNo: 'PO-101',
        kind: 'PO',
        partyCode: 'SUP-1',
        orderedQty: '10',
        fulfilledQty: '4',
        unitPriceMinor: 500_000n,
      },
      {
        orderNo: 'SO-201',
        kind: 'SO',
        partyCode: 'CUS-1',
        orderedQty: '5',
        fulfilledQty: '2',
        unitPriceMinor: 1_000_000n,
        depositMinor: 800_000n,
      },
    ]);

    expect(imported[0]).toMatchObject({
      orderNo: 'PO-101',
      status: 'PARTIAL',
      fulfilledQty: '4',
      remainingQty: '6',
      fulfilledValueMinor: 2_000_000n,
      remainingValueMinor: 3_000_000n,
    });
    expect(imported[1]).toMatchObject({
      orderNo: 'SO-201',
      status: 'PARTIAL',
      fulfilledQty: '2',
      remainingQty: '3',
      remainingValueMinor: 3_000_000n,
      depositMinor: 800_000n,
      netOpenMinor: 2_200_000n,
    });
  });

  it('rejects fulfilledQty > orderedQty or negative quantities', () => {
    expect(() =>
      importOpenOrders([
        {
          orderNo: 'PO-BAD',
          kind: 'PO',
          partyCode: 'SUP-1',
          orderedQty: '5',
          fulfilledQty: '6',
          unitPriceMinor: 100_000n,
        },
      ]),
    ).toThrow(BadRequestException);
  });
});
