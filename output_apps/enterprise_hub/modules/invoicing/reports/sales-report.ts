import { minorToDecimal, parseScaled, scaledToDecimal, toMinor } from '../../accounting/money';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { invoiceRateLines, invoiceRialAmounts } from '../../tax_compliance/reports/invoice-rial-amounts';
import { InvoiceEntity } from '../entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

export type SalesGroupBy = 'item' | 'customer';

/** The invoice fields this report reads. */
export type SalesDoc = Pick<
  InvoiceEntity,
  | 'id'
  | 'createdAt'
  | 'relatedInvoiceId'
  | 'direction'
  | 'subject'
  | 'status'
  | 'currency'
  | 'fxRate'
  | 'finalPayable'
  | 'totalTax'
  | 'buyerInfo'
  | 'items'
>;

export interface SalesGroup {
  key: string;
  /** Quantity in thousandths (invoice quantities carry at most 3 decimals). */
  quantityMilli: bigint;
  /** Net of discount and VAT, in rial minor units. */
  netMinor: bigint;
  /** VAT in rial minor units. */
  vatMinor: bigint;
  /** Net in the document currency, minor units, per foreign currency. For information only. */
  foreign: Map<string, bigint>;
}

const RIAL = 'IRR';
const QUANTITY_SCALE = 3;

function rootOf(doc: SalesDoc, byId: Map<string, SalesDoc>): string {
  let current = doc;
  const seen = new Set<string>();
  while (current.relatedInvoiceId != null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.relatedInvoiceId);
    if (!parent) return current.relatedInvoiceId;
    current = parent;
  }
  return current.id;
}

/**
 * The documents that count, each with its sign, by the rules the ledger posts (invoice-posting.service):
 * a corrective replaces what it amends, so only the newest one of a chain counts; a return subtracts;
 * a cancellation removes its whole chain.
 */
function countedDocs(docs: readonly SalesDoc[]): Array<{ doc: SalesDoc; sign: bigint }> {
  const issued = docs.filter(
    (doc) =>
      doc.direction === InvoiceDirection.SALE &&
      (doc.status === InvoiceStatus.ISSUED || doc.status === InvoiceStatus.PAID),
  );
  const byId = new Map(issued.map((doc) => [doc.id, doc]));
  const cancelled = new Set<string>();
  const newestCorrective = new Map<string, SalesDoc>();
  for (const doc of issued) {
    const root = rootOf(doc, byId);
    if (doc.subject === InvoiceSubject.CANCEL) cancelled.add(root);
    if (doc.subject === InvoiceSubject.CORRECTIVE) {
      const newest = newestCorrective.get(root);
      // Ids are UUIDs, so order by createdAt, as correctiveBaseline in the posting service does.
      if (!newest || new Date(doc.createdAt) >= new Date(newest.createdAt)) newestCorrective.set(root, doc);
    }
  }
  const counted: Array<{ doc: SalesDoc; sign: bigint }> = [];
  for (const doc of issued) {
    const root = rootOf(doc, byId);
    if (cancelled.has(root) || doc.subject === InvoiceSubject.CANCEL) continue;
    if (doc.subject === InvoiceSubject.RETURN) {
      counted.push({ doc, sign: -1n });
      continue;
    }
    const newest = newestCorrective.get(root);
    if (newest === undefined ? doc.subject === InvoiceSubject.ORIGINAL : doc.id === newest.id) {
      counted.push({ doc, sign: 1n });
    }
  }
  return counted;
}

/**
 * Sales grouped by item or customer. Foreign invoices are converted at the rate on the invoice by the
 * same helpers as the ledger and the VAT reports, so a document's lines add up exactly to what it posted.
 */
export function salesReport(docs: readonly SalesDoc[], groupBy: SalesGroupBy): SalesGroup[] {
  const groups = new Map<string, SalesGroup>();
  for (const { doc, sign } of countedDocs(docs)) {
    const invoice = doc as InvoiceEntity;
    const rialLines = invoiceRateLines(invoice, invoiceRialAmounts(invoice));
    (doc.items ?? []).forEach((item, index) => {
      const key = groupBy === 'item' ? item.sku || item.description : doc.buyerInfo?.name || 'بدون نام';
      const group = groups.get(key) ?? {
        key,
        quantityMilli: 0n,
        netMinor: 0n,
        vatMinor: 0n,
        foreign: new Map<string, bigint>(),
      };
      group.quantityMilli += sign * parseScaled(item.quantity, QUANTITY_SCALE);
      group.netMinor += sign * rialLines[index].baseMinor;
      group.vatMinor += sign * rialLines[index].vatMinor;
      if (doc.currency !== RIAL) {
        const net = toMinor(item.total) - toMinor(item.tax);
        group.foreign.set(doc.currency, (group.foreign.get(doc.currency) ?? 0n) + sign * net);
      }
      groups.set(key, group);
    });
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'fa'));
}

function quantityText(milli: bigint): string {
  const sign = milli < 0n ? '-' : '';
  const text = scaledToDecimal(milli < 0n ? -milli : milli, QUANTITY_SCALE);
  return sign + text.replace(/\.?0+$/, '');
}

function foreignText(foreign: Map<string, bigint>): string {
  return [...foreign.entries()]
    .filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${minorToDecimal(amount)} ${currency}`)
    .join('، ');
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
  const foreignTotal = new Map<string, bigint>();
  for (const group of groups) {
    for (const [currency, amount] of group.foreign) {
      foreignTotal.set(currency, (foreignTotal.get(currency) ?? 0n) + amount);
    }
  }
  rows.push({
    bold: true,
    cells: [
      'جمع',
      null,
      groups.reduce((sum, group) => sum + group.netMinor, 0n),
      groups.reduce((sum, group) => sum + group.vatMinor, 0n),
      foreignText(foreignTotal),
    ],
  });
  return { title: TITLES[groupBy], subtitle, columns, rows };
}
