import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { ReportDoc } from './invoice-docs';
import { purchasesReport, purchasesReportTable } from './purchases-report';

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

function doc(overrides: Partial<ReportDoc> & { items: ReportDoc['items'] }): ReportDoc {
  const finalPayable = overrides.items.reduce((sum, item) => sum + item.total, 0);
  const totalTax = overrides.items.reduce((sum, item) => sum + item.tax, 0);
  return {
    id: `00000000-0000-4000-8000-${String(1000 - nextId).padStart(12, '0')}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, nextId++)),
    relatedInvoiceId: null,
    direction: InvoiceDirection.PURCHASE,
    subject: InvoiceSubject.ORIGINAL,
    status: InvoiceStatus.ISSUED,
    currency: 'IRR',
    fxRate: 1,
    finalPayable,
    totalTax,
    sellerInfo: { name: 'تأمین‌کننده نمونه' },
    ...overrides,
  } as ReportDoc;
}

const only = (docs: ReportDoc[]) => purchasesReport(docs, 'item')[0];

describe('purchasesReport', () => {
  it('groups by item and by supplier with exact amounts', () => {
    const docs = [
      doc({ items: [line('A', 2, 1000, 200), line('B', 1, 500, 50)] }),
      doc({ items: [line('A', 1, 1000, 100)], sellerInfo: { name: 'تأمین‌کننده دوم' } as ReportDoc['sellerInfo'] }),
    ];
    expect(purchasesReport(docs, 'item').map((g) => [g.key, g.quantityMilli, g.netMinor, g.vatMinor])).toEqual([
      ['A', 3000n, 300000n, 30000n],
      ['B', 1000n, 50000n, 5000n],
    ]);
    expect(purchasesReport(docs, 'supplier').map((g) => [g.key, g.netMinor])).toEqual([
      ['تأمین‌کننده دوم', 100000n],
      ['تأمین‌کننده نمونه', 250000n],
    ]);
  });

  it('leaves out drafts, cancelled invoices and sales', () => {
    expect(
      purchasesReport(
        [
          doc({ status: InvoiceStatus.DRAFT, items: [line('A', 1, 1000, 100)] }),
          doc({ status: InvoiceStatus.CANCELLED, items: [line('A', 1, 1000, 100)] }),
          doc({ direction: InvoiceDirection.SALE, items: [line('A', 1, 1000, 100)] }),
        ],
        'item',
      ),
    ).toEqual([]);
  });

  it('counts a paid invoice and subtracts a partial return', () => {
    const purchase = doc({ status: InvoiceStatus.PAID, items: [line('A', 5, 1000, 500)] });
    const back = doc({ subject: InvoiceSubject.RETURN, relatedInvoiceId: purchase.id, items: [line('A', 2, 1000, 200)] });
    expect(only([purchase, back])).toMatchObject({ quantityMilli: 3000n, netMinor: 300000n, vatMinor: 30000n });
  });

  it('counts only the newest corrective of a chain, not the amounts it replaced', () => {
    const purchase = doc({ items: [line('A', 5, 1000, 500)] });
    const first = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: purchase.id, items: [line('A', 4, 1000, 400)] });
    const second = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: first.id, items: [line('A', 3, 1000, 300)] });
    expect(only([purchase, first, second])).toMatchObject({ quantityMilli: 3000n, netMinor: 300000n });
  });

  it('removes a whole chain when it is cancelled', () => {
    const purchase = doc({ items: [line('A', 5, 1000, 500)] });
    const fix = doc({ subject: InvoiceSubject.CORRECTIVE, relatedInvoiceId: purchase.id, items: [line('A', 4, 1000, 400)] });
    const cancel = doc({ subject: InvoiceSubject.CANCEL, relatedInvoiceId: purchase.id, items: [line('A', 5, 1000, 500)] });
    const other = doc({ items: [line('B', 1, 1000, 100)] });
    expect(purchasesReport([purchase, fix, cancel, other], 'item').map((g) => g.key)).toEqual(['B']);
  });

  it('converts a foreign invoice at its own rate, into the rial totals', () => {
    const usd = doc({ currency: 'USD', fxRate: 600000, items: [line('A', 2, 10.5, 2.1)] } as Partial<ReportDoc> & {
      items: ReportDoc['items'];
    });
    const rial = doc({ items: [line('A', 1, 1000, 100)] });
    const group = only([usd, rial]);
    expect(group.netMinor).toBe(1260000000n + 100000n);
    expect(group.vatMinor).toBe(126000000n + 10000n);
    expect(group.foreign.get('USD')).toBe(2100n);
  });

  it('subtracts a foreign return from both the rial and the currency amount', () => {
    const usd = doc({ currency: 'USD', fxRate: 500000, items: [line('A', 3, 10, 0)] } as Partial<ReportDoc> & {
      items: ReportDoc['items'];
    });
    const back = doc({
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: usd.id,
      currency: 'USD',
      fxRate: 500000,
      items: [line('A', 1, 10, 0)],
    } as Partial<ReportDoc> & { items: ReportDoc['items'] });
    const group = only([usd, back]);
    expect(group.netMinor).toBe(1000000000n);
    expect(group.foreign.get('USD')).toBe(2000n);
  });
});

describe('purchasesReportTable', () => {
  it('has Persian labels, money columns, a currency column and a bold total', () => {
    const groups = purchasesReport(
      [
        doc({ items: [line('A', 1.5, 1000, 150)] }),
        doc({ currency: 'USD', fxRate: 600000, items: [line('B', 1, 10, 1)] } as Partial<ReportDoc> & {
          items: ReportDoc['items'];
        }),
      ],
      'item',
    );
    const table = purchasesReportTable(groups, 'item', 'دوره');
    expect(table.title).toBe('خرید به تفکیک کالا');
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
