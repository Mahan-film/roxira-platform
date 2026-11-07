/**
 * Hand-computed numbers of the purchase-cycle gate (#227 T2): purchase order -> 2 goods receipts -> supplier
 * invoice with a price difference -> late freight, on one synthetic item of its own. Rials, whole numbers;
 * the purchasing API takes hundredths ("minor units"): 50,000 rials is "5000000", 60.00 units is "6000".
 *
 *   Order:      100.00 units at 50,000 = 5,000,000 (tolerance for a price difference set to 5%).
 *   Receipt 1:  60.00 units = 3,000,000 into FIFO layer 1 (60 at 50,000); Dr stock, Cr goods received not invoiced.
 *   Sale:       20.00 units delivered from layer 1 at 50,000 = 1,000,000 cost of goods sold; layer 1 holds 40.00.
 *   Receipt 2:  40.00 units = 2,000,000 into layer 2 (40 at 50,000).
 *   Invoice:    receipt 1 billed at 51,000 (60 x 51,000 = 3,060,000, +60,000 = +2%, inside 5%), receipt 2 at 50,000
 *               (2,000,000): subtotal 5,060,000, VAT 10% = 506,000, payable 5,566,000.
 *               Voucher: Dr received-not-invoiced 5,000,000, Dr price variance 60,000, Dr VAT input 506,000,
 *               Cr supplier payable 5,566,000.
 *   Freight:    900,000 arrives late for receipt 1, allocated by value (one line, so all of it): layer 1 has 40 of
 *               its 60 units left, so 40/60 x 900,000 = 600,000 raises layer 1 (+15,000 a unit: 40 at 65,000) and
 *               300,000 goes to cost of goods sold for the 20 already sold. Voucher: Dr stock 600,000,
 *               Dr COGS 300,000, Cr supplier payable 900,000.
 *   Net:        stock +3,000,000 +2,000,000 -1,000,000 +600,000 = 4,600,000 = layer 1 2,600,000 + layer 2 2,000,000;
 *               COGS 1,000,000 + 300,000 = 1,300,000; payable credit 5,566,000 + 900,000 = 6,466,000.
 */
export const T2_GATE = {
  sku: 'T2-GATE-A',
  barcode: 'T2-GATE-0001',
  supplierCode: 'T2-SUP-1',
  orderQuantity: '10000',
  unitPrice: '5000000',
  receipt1: { quantity: '6000', value: 3_000_000n },
  receipt2: { quantity: '4000', value: 2_000_000n },
  sale: { quantity: 20, unitPrice: 100_000, cost: 1_000_000n },
  invoice: {
    receipt1UnitPrice: '5100000',
    receipt2UnitPrice: '5000000',
    subtotal: 5_060_000n,
    vat: 506_000n,
    payable: 5_566_000n,
    grni: 5_000_000n,
    variance: 60_000n,
  },
  freight: { amount: 900_000n, toInventory: 600_000n, toCogs: 300_000n },
  layer1: { quantity: 40, unitCost: 65_000, value: 2_600_000n },
  layer2: { quantity: 40, unitCost: 50_000, value: 2_000_000n },
  stockDelta: 4_600_000n,
  cogsDelta: 1_300_000n,
  payableDelta: -6_466_000n,
} as const;
