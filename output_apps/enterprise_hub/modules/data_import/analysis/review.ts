/**
 * صفحهٔ بازبینی پیش از ثبت: هر جدول در یکی از گروه‌های حسابداری قرار می‌گیرد و «همهٔ» سندهای پیشنهادی
 * صفحه‌به‌صفحه نشان داده می‌شوند. منطق ساخت ردیف همان `buildRecords` ثبت نهایی است، پس آنچه دیده می‌شود
 * همان است که ثبت می‌شود.
 */

import { PackageTableReader } from '../parsers/package-source.types';
import { EntityImportAdapter } from '../registry/import-registry.types';
import { PackageAnalysis } from './package-analysis';
import { buildRecords, concreteMapping } from './record-builder';
import { ReconcileSelection } from './reconciliation';

export type ReviewBucket = 'chart_of_accounts' | 'opening_balances' | 'parties' | 'items' | 'vouchers' | 'other';

const BUCKET_OF: Record<string, ReviewBucket> = {
  'accounting-accounts': 'chart_of_accounts',
  'accounting-opening-balances': 'opening_balances',
  'crm-leads': 'parties',
  'inventory-items': 'items',
  'accounting-journal-lines': 'vouchers',
};

const BUCKET_LABEL: Record<ReviewBucket, string> = {
  chart_of_accounts: 'سرفصل حساب‌ها',
  opening_balances: 'مانده‌های افتتاحیه',
  parties: 'اشخاص',
  items: 'کالاها',
  vouchers: 'اسناد حسابداری',
  other: 'سایر',
};

export const REVIEW_PAGE_SIZE = 50;
const SAMPLE_ROWS = 5;

export interface ReviewVoucherLine {
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
}

export interface ReviewVoucher {
  voucherNo: string;
  date: string;
  sourceTable: string;
  lines: ReviewVoucherLine[];
  debit: number;
  credit: number;
  balanced: boolean;
}

export interface ReviewGroup {
  bucket: ReviewBucket;
  labelFa: string;
  rows: number;
  validRows: number;
  invalidRows: number;
  tables: Array<{ name: string; entity: string }>;
  sample: Array<Record<string, unknown>>;
  errorsFa: string[];
}

export interface PackageReview {
  groups: ReviewGroup[];
  skippedTables: string[];
  vouchers: { total: number; unbalanced: number; page: number; pageSize: number; items: ReviewVoucher[] };
}

const amount = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

/** The opening-balance rows post as one voucher, so they are shown as one. */
const OPENING_VOUCHER = 'سند افتتاحیه';

export function buildReview(
  tables: PackageTableReader[],
  analysis: PackageAnalysis,
  adapters: EntityImportAdapter[],
  selections: ReconcileSelection[],
  page: number,
): PackageReview {
  const groups = new Map<ReviewBucket, ReviewGroup>();
  const vouchers = new Map<string, ReviewVoucher>();
  const skippedTables: string[] = [];

  for (const selection of selections) {
    const table = tables.find((t) => t.name === selection.name);
    const adapter = adapters.find((a) => a.key === selection.entity);
    if (selection.skip || !table || !adapter) {
      skippedTables.push(selection.name);
      continue;
    }
    const proposed = analysis.tables.find((t) => t.name === selection.name)?.mapping ?? {};
    const built = buildRecords(adapter, table, concreteMapping(adapter, selection.mapping, proposed), {
      moneyToRial: selection.moneyToRial,
    });
    const bucket = BUCKET_OF[adapter.key] ?? 'other';
    const group: ReviewGroup = groups.get(bucket) ?? {
      bucket,
      labelFa: BUCKET_LABEL[bucket],
      rows: 0,
      validRows: 0,
      invalidRows: 0,
      tables: [],
      sample: [],
      errorsFa: [],
    };
    groups.set(bucket, group);
    group.rows += table.rowCount;
    group.validRows += built.records.length;
    group.invalidRows += built.invalidRows;
    group.tables.push({ name: table.name, entity: adapter.key });
    group.errorsFa.push(...built.errors.slice(0, 20));
    group.sample.push(...built.records.slice(0, SAMPLE_ROWS - group.sample.length).map((r) => r.values));

    if (bucket !== 'vouchers' && bucket !== 'opening_balances') {
      continue;
    }
    const isJournal = bucket === 'vouchers';
    for (const { values } of built.records) {
      const voucherNo = isJournal ? text(values.voucherNo) : OPENING_VOUCHER;
      const key = `${table.name}\u0000${voucherNo}`;
      const voucher: ReviewVoucher = vouchers.get(key) ?? {
        voucherNo,
        date: text(values.date),
        sourceTable: table.name,
        lines: [],
        debit: 0,
        credit: 0,
        balanced: false,
      };
      vouchers.set(key, voucher);
      const debit = amount(isJournal ? values.debitRial : values.debit);
      const credit = amount(isJournal ? values.creditRial : values.credit);
      voucher.lines.push({ accountCode: text(values.accountCode), description: text(values.description), debit, credit });
      voucher.debit += debit;
      voucher.credit += credit;
    }
  }

  const all = [...vouchers.values()];
  for (const voucher of all) {
    voucher.balanced = Math.abs(voucher.debit - voucher.credit) < 0.005;
  }
  const order: ReviewBucket[] = ['chart_of_accounts', 'opening_balances', 'parties', 'items', 'vouchers', 'other'];
  const pageIndex = Math.max(1, Math.floor(page)) - 1;
  return {
    groups: order.flatMap((bucket) => (groups.has(bucket) ? [groups.get(bucket) as ReviewGroup] : [])),
    skippedTables,
    vouchers: {
      total: all.length,
      unbalanced: all.filter((v) => !v.balanced).length,
      page: pageIndex + 1,
      pageSize: REVIEW_PAGE_SIZE,
      items: all.slice(pageIndex * REVIEW_PAGE_SIZE, (pageIndex + 1) * REVIEW_PAGE_SIZE),
    },
  };
}
