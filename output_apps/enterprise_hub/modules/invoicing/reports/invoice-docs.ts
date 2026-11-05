import { minorToDecimal, parseScaled, scaledToDecimal, toMinor } from '../../accounting/money';
import { invoiceRateLines, invoiceRialAmounts } from '../../tax_compliance/reports/invoice-rial-amounts';
import { InvoiceEntity, InvoiceItem } from '../entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/** The invoice fields these reports read. */
export type ReportDoc = Pick<
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
  | 'sellerInfo'
  | 'items'
>;

export const RIAL = 'IRR';
export const QUANTITY_SCALE = 3;

export function rootOf(doc: ReportDoc, byId: Map<string, ReportDoc>): string {
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
 * The issued or paid documents of one direction whose chain still stands, each with the id of its
 * chain root: the CANCEL document itself and every document of a cancelled chain are gone, while
 * the original a corrective replaced is still live, because the stock it moved (its recorded cost)
 * stands until a return reverses it. Every counted or cost-carrying document is live.
 */
export function liveDocs<D extends ReportDoc = ReportDoc>(
  docs: readonly D[],
  direction: InvoiceDirection,
): Array<{ doc: D; root: string }> {
  const issued = docs.filter(
    (doc) =>
      doc.direction === direction &&
      (doc.status === InvoiceStatus.ISSUED || doc.status === InvoiceStatus.PAID),
  );
  const byId = new Map<string, ReportDoc>(issued.map((doc) => [doc.id, doc]));
  const cancelled = new Set<string>();
  const live: Array<{ doc: D; root: string }> = [];
  for (const doc of issued) {
    const root = rootOf(doc, byId);
    if (doc.subject === InvoiceSubject.CANCEL) {
      cancelled.add(root);
      continue;
    }
    live.push({ doc, root });
  }
  return live.filter(({ root }) => !cancelled.has(root));
}

/**
 * The documents that count, each with its sign, by the rules the ledger posts (invoice-posting.service):
 * a corrective replaces what it amends, so only the newest one of a chain counts; a return subtracts;
 * a cancellation removes its whole chain. Every counted document is live (see `liveDocs`); the
 * documents `liveDocs` keeps beyond these are exactly the replaced originals that still carry cost.
 */
export function countedDocs(docs: readonly ReportDoc[], direction: InvoiceDirection): Array<{ doc: ReportDoc; sign: bigint }> {
  const live = liveDocs(docs, direction);
  const newestCorrective = new Map<string, ReportDoc>();
  for (const { doc, root } of live) {
    if (doc.subject === InvoiceSubject.CORRECTIVE) {
      const newest = newestCorrective.get(root);
      // Ids are UUIDs, so order by createdAt, as correctiveBaseline in the posting service does.
      if (!newest || new Date(doc.createdAt) >= new Date(newest.createdAt)) newestCorrective.set(root, doc);
    }
  }
  const counted: Array<{ doc: ReportDoc; sign: bigint }> = [];
  for (const { doc, root } of live) {
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

export interface DocGroup {
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

/**
 * Accumulates the counted documents into groups keyed by `keyOf(doc, item)` for every item, with the
 * amounts the ledger posts: rial lines from invoiceRateLines, and for foreign invoices also the net
 * in the document currency. The caller flattens and sorts the map, so the reports differ only in
 * their key functions.
 */
export function groupDocs(
  docs: readonly ReportDoc[],
  direction: InvoiceDirection,
  keyOf: (doc: ReportDoc, item: InvoiceItem) => string,
): Map<string, DocGroup> {
  const groups = new Map<string, DocGroup>();
  for (const { doc, sign } of countedDocs(docs, direction)) {
    const invoice = doc as InvoiceEntity;
    const rialLines = invoiceRateLines(invoice, invoiceRialAmounts(invoice));
    (doc.items ?? []).forEach((item, index) => {
      const key = keyOf(doc, item);
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
  return groups;
}

export function quantityText(milli: bigint): string {
  const sign = milli < 0n ? '-' : '';
  const text = scaledToDecimal(milli < 0n ? -milli : milli, QUANTITY_SCALE);
  return sign + text.replace(/\.?0+$/, '');
}

export function foreignText(foreign: Map<string, bigint>): string {
  return [...foreign.entries()]
    .filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${minorToDecimal(amount)} ${currency}`)
    .join('، ');
}

export function foreignTotal(groups: Iterable<{ foreign: Map<string, bigint> }>): Map<string, bigint> {
  const total = new Map<string, bigint>();
  for (const group of groups) {
    for (const [currency, amount] of group.foreign) {
      total.set(currency, (total.get(currency) ?? 0n) + amount);
    }
  }
  return total;
}
