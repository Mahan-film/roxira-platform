/**
 * Hand-computed numbers of the sales-cycle gate (#227 T1, slice 6): quote -> order -> 2 partial deliveries
 * -> 1 invoice -> partial return, on one synthetic item of its own so the figures never depend on the rest
 * of the month. Rials, whole numbers; quantities have two decimals.
 *
 *   Stock in:   4.00 at 500,000 (layer 1), then 6.00 at 700,000 (layer 2)  -> on hand 10.00
 *   Quote/order: 8.00 at 1,000,000 = 8,000,000 (reserves 8.00; available 10 - 8 = 2.00)
 *   Delivery 1: 3.00 from layer 1                        = 1,500,000 (3 x 500,000)   on hand 7.00, reserved 5.00
 *   Delivery 2: 4.00 = 1.00 left in layer 1 + 3.00 of layer 2
 *                                                        =   500,000 + 2,100,000 = 2,600,000  (650,000 a unit)
 *                                                          on hand 3.00, reserved 1.00 (backorder 1.00)
 *   Invoice:    3.00 of delivery 1 + 4.00 of delivery 2 = 7.00 x 1,000,000 = 7,000,000, VAT 10% = 700,000,
 *               payable 7,700,000. Revenue and VAT only: the deliveries already booked stock and cost.
 *   Return:     2.00 of delivery 2 (unit cost 650,000): credit 2 x 1,000,000 = 2,000,000 + VAT 200,000 = 2,200,000;
 *               stock back 2 x 650,000 = 1,300,000; on hand 5.00.
 *   Net:        customer owes 7,700,000 - 2,200,000 = 5,500,000; cost of goods sold
 *               1,500,000 + 2,600,000 - 1,300,000 = 2,800,000.
 *   Stock left: delivery 1 and 2 took layer 1 (4.00) and 3.00 of layer 2, leaving 3.00 x 700,000 = 2,100,000;
 *               the return puts back 2.00 at 650,000 = 1,300,000; value 3,400,000 for 5.00 units.
 */
export const T1_GATE = {
  sku: 'T1-GATE-A',
  barcode: 'T1-GATE-0001',
  partyCode: 'T1-CUST-1',
  layer1: { quantity: 4, unitCost: 500_000 },
  layer2: { quantity: 6, unitCost: 700_000 },
  orderQuantity: 8,
  unitPrice: 1_000_000,
  quoteTotal: 8_000_000n,
  delivery1: { quantity: 3, cost: 1_500_000n },
  delivery2: { quantity: 4, cost: 2_600_000n, unitCost: 650_000n },
  invoice: { quantity: 7, net: 7_000_000n, vat: 700_000n, payable: 7_700_000n },
  salesReturn: { quantity: 2, net: 2_000_000n, vat: 200_000n, payable: 2_200_000n, stock: 1_300_000n },
  customerBalance: 5_500_000n,
  netCogs: 2_800_000n,
  finalOnHand: 5,
  finalStockValue: 3_400_000n,
} as const;
