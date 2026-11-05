import { InvoiceItem } from '../entities/invoice.entity';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { DocGroup, foreignText, foreignTotal, groupDocs, quantityText, ReportDoc } from './invoice-docs';

export type SalesGroupBy = 'item' | 'customer';
export type SalesDoc = ReportDoc;
export type SalesGroup = DocGroup;

const KEY_OF: Record<SalesGroupBy, (doc: ReportDoc, item: InvoiceItem) => string> = {
  item: (_doc, item) => item.sku || item.description,
  customer: (doc) => doc.buyerInfo?.name || 'بدون نام',
};

/** Sales grouped by item or customer, in the amounts the ledger posted. */
export function salesReport(docs: readonly SalesDoc[], groupBy: SalesGroupBy): SalesGroup[] {
  return [...groupDocs(docs, InvoiceDirection.SALE, KEY_OF[groupBy]).values()].sort((a, b) =>
    a.key.localeCompare(b.key, 'fa'),
  );
}

const TITLES: Record<SalesGroupBy, string> = { item: 'فروش به تفکیک کالا', customer: 'فروش به تفکیک مشتری' };
const KEY_COLUMNS: Record<SalesGroupBy, string> = { item: 'کالا', customer: 'مشتری' };

export function salesReportTable(groups: readonly SalesGroup[], groupBy: SalesGroupBy, subtitle = ''): ReportTable {
  const columns: ReportColumn[] = [
    { title: KEY_COLUMNS[groupBy], width: 2 },
    { title: 'مقدار' },
    { title: 'فروش خالص (ریال)', money: true },
    { title: 'مالیات بر ارزش افزوده (ریال)', money: true },
    { title: 'ارز و مبلغ ارزی', width: 1.4 },
  ];
  const rows: ReportRow[] = groups.map((group) => ({
    cells: [group.key, quantityText(group.quantityMilli), group.netMinor, group.vatMinor, foreignText(group.foreign)],
  }));
  const fTotal = foreignTotal(groups);
  rows.push({
    bold: true,
    cells: [
      'جمع',
      null,
      groups.reduce((sum, group) => sum + group.netMinor, 0n),
      groups.reduce((sum, group) => sum + group.vatMinor, 0n),
      foreignText(fTotal),
    ],
  });
  return { title: TITLES[groupBy], subtitle, columns, rows };
}
