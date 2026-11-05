import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { SalesDoc, salesReport, salesReportTable } from './sales-report';

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

function doc(overrides: Partial<SalesDoc> & { items: SalesDoc['items'] }): SalesDoc {
  const finalPayable = overrides.items.reduce((sum, item) => sum + item.total, 0);
  const totalTax = overrides.items.reduce((sum, item) => sum + item.tax, 0);
  return {
    id: `00000000-0000-4000-8000-${String(1000 - nextId).padStart(12, '0')}`, // ids do not sort by age
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, nextId++)),
    relatedInvoiceId: null,
    direction: InvoiceDirection.SALE,
    subject: InvoiceSubject.ORIGINAL,
    status: InvoiceStatus.ISSUED,
    currency: 'IRR',
    fxRate: 1,
    finalPayable,
    totalTax,
    buyerInfo: { name: 'شرکت نمونه' },
    ...overrides,
  } as SalesDoc;
}

const only = (docs: SalesDoc[]) => salesReport(docs, 'item')[0];

describe('salesReport', () => {
  it('groups by item and by customer with exact amounts', () => {
    const docs = [
      doc({ items: [line('A', 2, 1000, 200), line('B', 1, 500, 50)] }),
      doc({ items: [line('A', 1, 1000, 100)], buyerInfo: { name: 'فروشگاه دوم' } as SalesDoc['buyerInfo'] }),
    ];
    expect(salesReport(docs, 'item').map((g) => [g.key, g.quantityMilli, g.netMinor, g.vatMinor])).toEqual([
      ['A', 3000n, 300000n, 30000n],
      ['B', 1000n, 50000n, 5000n],
    ]);
    expect(salesReport(docs, 'customer').map((g) => [g.key, g.netMinor])).toEqual([
      ['شرکت نمونه', 250000n],
      ['فروشگاه دوم', 100000n],
    ]);
  });

  it('leaves out drafts, cancelled invoices and purchases', () => {
    expect(
      salesReport(
        [
          doc({ status: InvoiceStatus.DRAFT, items: [line('A', 1, 1000, 100)] }),
          doc({ status: InvoiceStatus.CANCELLED, items: [line('A', 1, 1000, 100)] }),
          doc({ direction: InvoiceDirection.PURCHASE, items: [line('A', 1, 1000, 100)] }),
        ],
        'item',
      ),
    ).toEqual([]);
  });

  it('counts a paid invoice and subtracts a partial return', () => {
    const sale = doc({ status: InvoiceStatus.PAID, items: [line('A', 5, 1000, 500)] });
    const back = doc({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, items: [line('A', 2, 1000, 200)] });
    expect(only([sale, back])).toMatchObject({ quantityMilli: 3000n, netMinor: 300000n, vatMinor: 30000n });
  });

  it('counts only the newest corrective of a chain, not the amounts it replaced', () => {
    const sale = doc({ items: [line('A', 5, 1000, 500)] });
    const first = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: sale.id, items: [line('A', 4, 1000, 400)] });
    const second = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: first.id, items: [line('A', 3, 1000, 300)] });
    expect(only([sale, first, second])).toMatchObject({ quantityMilli: 3000n, netMinor: 300000n });
  });

  it('keeps a return against a corrected invoice', () => {
    const sale = doc({ items: [line('A', 5, 1000, 500)] });
    const fix = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: sale.id, items: [line('A', 4, 1000, 400)] });
    const back = doc({ subject: InvoiceSubject.RETURN, relatedInvoiceId: sale.id, items: [line('A', 1, 1000, 100)] });
    expect(only([sale, fix, back])).toMatchObject({ quantityMilli: 3000n, netMinor: 300000n });
  });

  it('removes a whole chain when it is cancelled', () => {
    const sale = doc({ items: [line('A', 5, 1000, 500)] });
    const fix = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: sale.id, items: [line('A', 4, 1000, 400)] });
    const cancel = doc({ subject: InvoiceSubject.CANCEL, relatedInvoiceId: sale.id, items: [line('A', 5, 1000, 500)] });
    const other = doc({ items: [line('B', 1, 1000, 100)] });
    expect(salesReport([sale, fix, cancel, other], 'item').map((g) => g.key)).toEqual(['B']);
  });

  it('converts a foreign invoice at its own rate, into the rial totals', () => {
    const usd = doc({ currency: 'USD', fxRate: 600000, items: [line('A', 2, 10.5, 2.1)] } as Partial<SalesDoc> & {
      items: SalesDoc['items'];
    });
    const rial = doc({ items: [line('A', 1, 1000, 100)] });
    const group = only([usd, rial]);
    expect(group.netMinor).toBe(1260000000n + 100000n);
    expect(group.vatMinor).toBe(126000000n + 10000n);
    expect(group.foreign.get('USD')).toBe(2100n);
  });

  it('subtracts a foreign return from both the rial and the currency amount', () => {
    const usd = doc({ currency: 'USD', fxRate: 500000, items: [line('A', 3, 10, 0)] } as Partial<SalesDoc> & {
      items: SalesDoc['items'];
    });
    const back = doc({
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: usd.id,
      currency: 'USD',
      fxRate: 500000,
      items: [line('A', 1, 10, 0)],
    } as Partial<SalesDoc> & { items: SalesDoc['items'] });
    const group = only([usd, back]);
    expect(group.netMinor).toBe(1000000000n);
    expect(group.foreign.get('USD')).toBe(2000n);
  });

  it('ties each document to its invoice total when the rate leaves a rounding residue', () => {
    const usd = doc({
      currency: 'USD',
      fxRate: 3.333333,
      items: [line('A', 1, 0.1, 0), line('B', 1, 0.1, 0), line('C', 1, 0.1, 0)],
    } as Partial<SalesDoc> & { items: SalesDoc['items'] });
    const sum = salesReport([usd], 'item').reduce((total, group) => total + group.netMinor, 0n);
    expect(sum).toBe(100n); // 0.30 × 3.333333 = 1.00, not three rounded 0.33
  });
});

describe('salesReportTable', () => {
  it('has Persian labels, money columns, a currency column and a bold total', () => {
    const groups = salesReport(
      [
        doc({ items: [line('A', 1.5, 1000, 150)] }),
        doc({ currency: 'USD', fxRate: 600000, items: [line('B', 1, 10, 1)] } as Partial<SalesDoc> & {
          items: SalesDoc['items'];
        }),
      ],
      'item',
    );
    const table = salesReportTable(groups, 'item', 'دوره');
    expect(table.title).toBe('فروش به تفکیک کالا');
    expect(table.subtitle).toBe('دوره');
    expect(table.columns.map((c) => c.title)).toContain('ارز و مبلغ ارزی');
    expect(table.columns.filter((c) => c.money)).toHaveLength(2);
    expect(table.rows[0].cells).toEqual(['A', '1.5', 150000n, 15000n, '']);
    expect(table.rows[1].cells[4]).toBe('10.00 USD');
    const total = table.rows[2];
    expect(total.bold).toBe(true);
    expect(total.cells).toEqual(['جمع', null, 150000n + 600000000n, 15000n + 60000000n, '10.00 USD']);
  });
});
