import { toMinor } from '../../accounting/money';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { InvoiceEntity, InvoiceItem, InvoicePostingMeta } from '../entities/invoice.entity';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { groupDocs, liveDocs, ReportDoc } from './invoice-docs';

/**
 * `ReportDoc` plus the posting metadata and the tax invoice number this report reads. They stay
 * out of `ReportDoc` itself so the sales and purchases report fixtures keep type-checking as is.
 */
export type GrossProfitDoc = ReportDoc & Pick<InvoiceEntity, 'postingMeta' | 'taxInvoiceNumber'>;

export type ProfitGroupBy = 'invoice' | 'item' | 'customer';

export interface ProfitGroup {
  key: string;
  /** Net of VAT and discount, in rial minor units, exactly as the sales report counts it. */
  revenueMinor: bigint;
  /** The FIFO cost the postings recorded, in rial minor units; never recomputed here. */
  cogsMinor: bigint;
  profitMinor: bigint;
  /** Basis points of profit over revenue, rounded half away from zero; null without revenue. */
  marginBp: bigint | null;
}

/** One posting line as `moveStockAndMeasure` records it: the FIFO cost of what moved, in rial. */
type PostingLine = InvoicePostingMeta['lines'][number];

/**
 * The cost one posting line carries: an OUT line cost what left the warehouse, an IN line (a sale
 * return) reverses the cost the sale recorded. Never recomputed from prices or current stock.
 */
function lineCost(line: PostingLine): bigint {
  return (line.moved === 'OUT' ? 1n : -1n) * toMinor(line.value);
}

/**
 * Profit over revenue in basis points, with bigint arithmetic only: the quotient of the absolute
 * values is rounded half away from zero (ties round up in magnitude), then the sign of
 * `profit * revenue` is applied, so a margin over negative revenue or a negative profit both keep
 * a sensible sign. Null when there is no revenue to divide by.
 */
function marginBpFor(profitMinor: bigint, revenueMinor: bigint): bigint | null {
  if (revenueMinor === 0n) return null;
  const negative = (profitMinor < 0n) !== (revenueMinor < 0n);
  const profit = profitMinor < 0n ? -profitMinor : profitMinor;
  const revenue = revenueMinor < 0n ? -revenueMinor : revenueMinor;
  const scaled = profit * 10000n;
  const quotient = scaled / revenue;
  const rounded = 2n * (scaled % revenue) >= revenue ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** 1234n -> '12.34%', -500n -> '-5.00%', null -> ''. */
export function marginText(marginBp: bigint | null): string {
  if (marginBp === null) return '';
  const sign = marginBp < 0n ? '-' : '';
  const abs = marginBp < 0n ? -marginBp : marginBp;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}%`;
}

/**
 * Gross profit of the SALE documents, grouped by invoice chain, item or customer. Revenue is
 * exactly what the sales report counts; cost is what the postings recorded on every live document
 * (`liveDocs`), so the original of a corrected chain still carries its cost although its revenue
 * was replaced, and a cancelled chain carries neither revenue nor cost.
 */
export function grossProfitReport(docs: readonly GrossProfitDoc[], groupBy: ProfitGroupBy): ProfitGroup[] {
  const live = liveDocs(docs, InvoiceDirection.SALE);
  const rootByDocId = new Map(live.map(({ doc, root }) => [doc.id, root]));
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  /** The chain root's tax invoice number, or the root id itself when it is not among the docs. */
  const invoiceKey = (doc: ReportDoc): string => {
    const root = rootByDocId.get(doc.id) ?? doc.id;
    return byId.get(root)?.taxInvoiceNumber || root;
  };
  const REVENUE_KEY: Record<ProfitGroupBy, (doc: ReportDoc, item: InvoiceItem) => string> = {
    item: (_doc, item) => item.sku || item.description,
    customer: (doc) => doc.buyerInfo?.name || 'بدون نام',
    invoice: (doc) => invoiceKey(doc),
  };

  const revenue = new Map<string, bigint>();
  for (const [key, group] of groupDocs(docs, InvoiceDirection.SALE, REVENUE_KEY[groupBy])) {
    revenue.set(key, group.netMinor);
  }

  const cogs = new Map<string, bigint>();
  for (const { doc, root } of live) {
    const lines = doc.postingMeta?.lines ?? [];
    if (groupBy === 'item') {
      for (const line of lines) cogs.set(line.sku, (cogs.get(line.sku) ?? 0n) + lineCost(line));
      continue;
    }
    const key = groupBy === 'customer' ? doc.buyerInfo?.name || 'بدون نام' : invoiceKey(doc);
    cogs.set(key, (cogs.get(key) ?? 0n) + lines.reduce((sum, line) => sum + lineCost(line), 0n));
  }

  return [...new Set([...revenue.keys(), ...cogs.keys()])]
    .map((key) => {
      const revenueMinor = revenue.get(key) ?? 0n;
      const cogsMinor = cogs.get(key) ?? 0n;
      const profitMinor = revenueMinor - cogsMinor;
      return { key, revenueMinor, cogsMinor, profitMinor, marginBp: marginBpFor(profitMinor, revenueMinor) };
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'fa'));
}

const TITLES: Record<ProfitGroupBy, string> = {
  invoice: 'سود ناخالص به تفکیک فاکتور',
  item: 'سود ناخالص به تفکیک کالا',
  customer: 'سود ناخالص به تفکیک مشتری',
};
const KEY_COLUMNS: Record<ProfitGroupBy, string> = {
  invoice: 'شماره فاکتور',
  item: 'کالا',
  customer: 'مشتری',
};

export function grossProfitTable(groups: readonly ProfitGroup[], groupBy: ProfitGroupBy, subtitle = ''): ReportTable {
  const columns: ReportColumn[] = [
    { title: KEY_COLUMNS[groupBy], width: 2 },
    { title: 'فروش خالص (ریال)', money: true },
    { title: 'بهای تمام‌شده (ریال)', money: true },
    { title: 'سود ناخالص (ریال)', money: true },
    { title: 'حاشیه سود' },
  ];
  const rows: ReportRow[] = groups.map((group) => ({
    cells: [group.key, group.revenueMinor, group.cogsMinor, group.profitMinor, marginText(group.marginBp)],
  }));
  const revenueMinor = groups.reduce((sum, group) => sum + group.revenueMinor, 0n);
  const cogsMinor = groups.reduce((sum, group) => sum + group.cogsMinor, 0n);
  const profitMinor = groups.reduce((sum, group) => sum + group.profitMinor, 0n);
  rows.push({
    bold: true,
    cells: ['جمع', revenueMinor, cogsMinor, profitMinor, marginText(marginBpFor(profitMinor, revenueMinor))],
  });
  return { title: TITLES[groupBy], subtitle, columns, rows };
}
