import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import {
  GrossProfitDoc,
  grossProfitReport,
  grossProfitTable,
  marginText,
  ProfitGroup,
  ProfitGroupBy,
} from './gross-profit-report';

let nextId = 1;
const line = (sku: string, quantity: number, unitPrice: number, tax: number) => ({
  sku,
  description: `کالای ${sku}`,
  quantity,
  unitPrice,
  discount: 0,
  vatRate: 0.1,
  tax,
  total: quantity * unitPrice + tax,
});

const costLine = (sku: string, quantity: number, unitCost: number, value: number, moved: 'IN' | 'OUT' = 'OUT') => ({
  sku,
  quantity,
  unitCost,
  value,
  moved,
  warehouseId: null,
});

const meta = (stockValue: number, lines: Array<ReturnType<typeof costLine>>) => ({ stockValue, lines });

function doc(overrides: Partial<GrossProfitDoc> & { items: GrossProfitDoc['items'] }): GrossProfitDoc {
  const n = nextId++;
  const finalPayable = overrides.items.reduce((sum, item) => sum + item.total, 0);
  const totalTax = overrides.items.reduce((sum, item) => sum + item.tax, 0);
  return {
    id: `00000000-0000-4000-8000-${String(1000 - n).padStart(12, '0')}`, // ids do not sort by age
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)),
    relatedInvoiceId: null,
    direction: InvoiceDirection.SALE,
    subject: InvoiceSubject.ORIGINAL,
    status: InvoiceStatus.ISSUED,
    currency: 'IRR',
    fxRate: 1,
    finalPayable,
    totalTax,
    buyerInfo: { name: 'شرکت نمونه' },
    taxInvoiceNumber: `F-${n}`,
    postingMeta: null,
    ...overrides,
  } as GrossProfitDoc;
}

const rowOf = (docs: GrossProfitDoc[], groupBy: ProfitGroupBy, key: string): ProfitGroup | undefined =>
  grossProfitReport(docs, groupBy).find((group) => group.key === key);

describe('grossProfitReport', () => {
  it('computes revenue, recorded cost and margin per item, invoice and customer', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-1',
      items: [line('A', 5, 1000, 500), line('B', 1, 500, 50)],
      postingMeta: meta(3200, [costLine('A', 5, 600, 3000), costLine('B', 1, 200, 200)]),
    });
    expect(
      grossProfitReport([sale], 'item').map((g) => [g.key, g.revenueMinor, g.cogsMinor, g.profitMinor, g.marginBp]),
    ).toEqual([
      ['A', 500000n, 300000n, 200000n, 4000n],
      ['B', 50000n, 20000n, 30000n, 6000n],
    ]);
    expect(
      grossProfitReport([sale], 'invoice').map((g) => [g.key, g.revenueMinor, g.cogsMinor, g.profitMinor, g.marginBp]),
    ).toEqual([['F-1', 550000n, 320000n, 230000n, 4182n]]);
    expect(
      grossProfitReport([sale], 'customer').map((g) => [g.key, g.revenueMinor, g.cogsMinor, g.profitMinor]),
    ).toEqual([['شرکت نمونه', 550000n, 320000n, 230000n]]);
  });

  it('subtracts a partial return from both the revenue and the recorded cost', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-1',
      items: [line('A', 5, 1000, 500), line('B', 1, 500, 50)],
      postingMeta: meta(3200, [costLine('A', 5, 600, 3000), costLine('B', 1, 200, 200)]),
    });
    const back = doc({
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: sale.id,
      taxInvoiceNumber: 'F-2',
      items: [line('A', 2, 1000, 200)],
      postingMeta: meta(1200, [costLine('A', 2, 600, 1200, 'IN')]),
    });
    expect(
      grossProfitReport([sale, back], 'invoice').map((g) => [g.key, g.revenueMinor, g.cogsMinor, g.profitMinor, g.marginBp]),
    ).toEqual([['F-1', 350000n, 200000n, 150000n, 4286n]]);
    expect(
      grossProfitReport([sale, back], 'item').map((g) => [g.key, g.revenueMinor, g.cogsMinor, g.profitMinor, g.marginBp]),
    ).toEqual([
      ['A', 300000n, 180000n, 120000n, 4000n],
      ['B', 50000n, 20000n, 30000n, 6000n],
    ]);
  });

  it('replaces the revenue with the corrective but keeps the original recorded cost', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-2',
      items: [line('A', 5, 1000, 500)],
      postingMeta: meta(3000, [costLine('A', 5, 600, 3000)]),
    });
    const fix = doc({
      subject: InvoiceSubject.CORRECTIVE,
      relatedInvoiceId: sale.id,
      taxInvoiceNumber: 'F-3',
      items: [line('A', 4, 1000, 400)],
      postingMeta: meta(0, []),
    });
    // The original's revenue (500000n) is not counted beside the corrective's 400000n.
    const expected = { revenueMinor: 400000n, cogsMinor: 300000n, profitMinor: 100000n, marginBp: 2500n };
    expect(grossProfitReport([sale, fix], 'invoice')).toEqual([{ key: 'F-2', ...expected }]);
    expect(grossProfitReport([sale, fix], 'item')).toEqual([{ key: 'A', ...expected }]);
  });

  it('drops a cancelled chain from revenue and cost alike', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-4',
      items: [line('A', 5, 1000, 500)],
      postingMeta: meta(3000, [costLine('A', 5, 600, 3000)]),
    });
    const cancel = doc({
      subject: InvoiceSubject.CANCEL,
      relatedInvoiceId: sale.id,
      taxInvoiceNumber: 'F-5',
      items: [line('A', 5, 1000, 500)],
    });
    const other = doc({
      taxInvoiceNumber: 'F-6',
      items: [line('B', 1, 500, 50)],
      postingMeta: meta(200, [costLine('B', 1, 200, 200)]),
    });
    expect(grossProfitReport([sale, cancel, other], 'item').map((g) => g.key)).toEqual(['B']);
    expect(grossProfitReport([sale, cancel, other], 'invoice').map((g) => [g.key, g.revenueMinor, g.cogsMinor])).toEqual([
      ['F-6', 50000n, 20000n],
    ]);
  });

  it('never recomputes the cost from prices', () => {
    const unposted = doc({ taxInvoiceNumber: 'F-7', items: [line('A', 5, 1000, 500)] });
    expect(grossProfitReport([unposted], 'item')).toEqual([
      { key: 'A', revenueMinor: 500000n, cogsMinor: 0n, profitMinor: 500000n, marginBp: 10000n },
    ]);
    const odd = doc({
      taxInvoiceNumber: 'F-8',
      items: [line('A', 5, 1000, 500)],
      postingMeta: meta(777, [costLine('A', 5, 155.4, 777)]),
    });
    expect(grossProfitReport([odd], 'item')).toEqual([
      { key: 'A', revenueMinor: 500000n, cogsMinor: 77700n, profitMinor: 422300n, marginBp: 8446n },
    ]);
  });

  it('converts a foreign invoice at its own rate and keeps the recorded cost', () => {
    const usd = doc({
      taxInvoiceNumber: 'F-9',
      currency: 'USD',
      fxRate: 600000,
      items: [line('A', 2, 10.5, 2.1)],
      postingMeta: meta(5000, [costLine('A', 2, 2500, 5000)]),
    } as Partial<GrossProfitDoc> & { items: GrossProfitDoc['items'] });
    expect(grossProfitReport([usd], 'item')).toEqual([
      { key: 'A', revenueMinor: 1260000000n, cogsMinor: 500000n, profitMinor: 1259500000n, marginBp: 9996n },
    ]);
  });

  it('rolls a chain into the root tax invoice number, or the root id when it is absent', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-11',
      items: [line('A', 5, 1000, 500)],
      postingMeta: meta(3000, [costLine('A', 5, 600, 3000)]),
    });
    const back = doc({
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: sale.id,
      taxInvoiceNumber: 'F-12',
      items: [line('A', 1, 1000, 100)],
    });
    const missing = '00000000-0000-4000-8000-000000000000';
    const orphan = doc({
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: missing,
      taxInvoiceNumber: 'F-13',
      items: [line('B', 1, 500, 50)],
    });
    const groups = grossProfitReport([sale, back, orphan], 'invoice');
    expect(groups.map((g) => g.key).sort()).toEqual([missing, 'F-11']);
    expect(rowOf([sale, back, orphan], 'invoice', 'F-11')).toMatchObject({
      revenueMinor: 400000n,
      cogsMinor: 300000n,
      profitMinor: 100000n,
      marginBp: 2500n,
    });
    // A negative return against a negative revenue: the sign of profit*revenue is positive.
    expect(rowOf([sale, back, orphan], 'invoice', missing)).toMatchObject({
      revenueMinor: -50000n,
      cogsMinor: 0n,
      profitMinor: -50000n,
      marginBp: 10000n,
    });
  });

  it('leaves the margin of a zero-revenue group empty', () => {
    const free = doc({ taxInvoiceNumber: 'F-10', items: [line('A', 1, 0, 0)] });
    const [group] = grossProfitReport([free], 'item');
    expect(group).toEqual({ key: 'A', revenueMinor: 0n, cogsMinor: 0n, profitMinor: 0n, marginBp: null });
    expect(marginText(group.marginBp)).toBe('');
  });
});

describe('marginText', () => {
  it('formats basis points with two decimals and a sign', () => {
    expect(marginText(1234n)).toBe('12.34%');
    expect(marginText(-500n)).toBe('-5.00%');
    expect(marginText(5n)).toBe('0.05%');
    expect(marginText(null)).toBe('');
  });
});

describe('grossProfitTable', () => {
  it('has Persian labels, three money columns and a bold total row of sums', () => {
    const sale = doc({
      taxInvoiceNumber: 'F-1',
      items: [line('A', 5, 1000, 500)],
      postingMeta: meta(3000, [costLine('A', 5, 600, 3000)]),
    });
    const other = doc({
      taxInvoiceNumber: 'F-2',
      items: [line('B', 1, 500, 50)],
      buyerInfo: { name: 'فروشگاه دوم' },
      postingMeta: meta(200, [costLine('B', 1, 200, 200)]),
    });
    const table = grossProfitTable(grossProfitReport([sale, other], 'customer'), 'customer', 'دوره');
    expect(table.title).toBe('سود ناخالص به تفکیک مشتری');
    expect(table.subtitle).toBe('دوره');
    expect(table.columns.map((column) => column.title)).toEqual([
      'مشتری',
      'فروش خالص (ریال)',
      'بهای تمام‌شده (ریال)',
      'سود ناخالص (ریال)',
      'حاشیه سود',
    ]);
    expect(table.columns.filter((column) => column.money)).toHaveLength(3);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['شرکت نمونه', 500000n, 300000n, 200000n, '40.00%'],
      ['فروشگاه دوم', 50000n, 20000n, 30000n, '60.00%'],
      ['جمع', 550000n, 320000n, 230000n, '41.82%'],
    ]);
    expect(table.rows[2].bold).toBe(true);
    const byItem = grossProfitTable(grossProfitReport([sale, other], 'item'), 'item');
    expect(byItem.title).toBe('سود ناخالص به تفکیک کالا');
    expect(byItem.columns[0]).toMatchObject({ title: 'کالا', width: 2 });
    const byInvoice = grossProfitTable(grossProfitReport([sale, other], 'invoice'), 'invoice');
    expect(byInvoice.title).toBe('سود ناخالص به تفکیک فاکتور');
    expect(byInvoice.columns[0]).toMatchObject({ title: 'شماره فاکتور', width: 2 });
  });
});
