import { InvoiceItem } from '../entities/invoice.entity';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { DocGroup, foreignText, foreignTotal, groupDocs, quantityText, ReportDoc } from './invoice-docs';

export type PurchaseGroupBy = 'item' | 'supplier';
export type PurchaseGroup = DocGroup;

const KEY_OF: Record<PurchaseGroupBy, (doc: ReportDoc, item: InvoiceItem) => string> = {
  item: (_doc, item) => item.sku || item.description,
  supplier: (doc) => doc.sellerInfo?.name || 'بدون نام',
};

/** Purchases grouped by item or supplier, in the amounts the ledger posted. */
export function purchasesReport(docs: readonly ReportDoc[], groupBy: PurchaseGroupBy): PurchaseGroup[] {
  return [...groupDocs(docs, InvoiceDirection.PURCHASE, KEY_OF[groupBy]).values()].sort((a, b) =>
    a.key.localeCompare(b.key, 'fa'),
  );
}

const TITLES: Record<PurchaseGroupBy, string> = { item: 'خرید به تفکیک کالا', supplier: 'خرید به تفکیک تأمین‌کننده' };
const KEY_COLUMNS: Record<PurchaseGroupBy, string> = { item: 'کالا', supplier: 'تأمین‌کننده' };

export function purchasesReportTable(groups: readonly PurchaseGroup[], groupBy: PurchaseGroupBy, subtitle = ''): ReportTable {
  const columns: ReportColumn[] = [
    { title: KEY_COLUMNS[groupBy], width: 2 },
    { title: 'مقدار' },
    { title: 'خرید خالص (ریال)', money: true },
    { title: 'مالیات ورودی (ریال)', money: true },
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
