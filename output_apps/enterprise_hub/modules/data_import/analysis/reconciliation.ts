/**
 * گزارش مغایرت‌گیری پس از پیش‌نمایش و پیش از ثبت: تعداد ردیف، جمع بدهکار/بستانکار، تراز هر سند،
 * مانده‌های افتتاحیه، تکراری‌های داخل فایل و ستون‌های بی‌نگاشت. ثبت نهایی با هر عدم‌تراز مسدود
 * می‌شود مگر مدیر/مالک صراحتاً تأیید کند.
 */

import { createHash } from 'crypto';
import { PackageTableReader } from '../parsers/package-source.types';
import { EntityImportAdapter } from '../registry/import-registry.types';
import { PackageAnalysis } from './package-analysis';
import { buildRecords, concreteMapping } from './record-builder';

/** انتخاب یک جدول برای ثبت/مغایرت‌گیری. */
export interface ReconcileSelection {
  name: string;
  entity: string;
  mapping: Record<string, string | null>;
  skip?: boolean;
  /** ضریب تبدیل مبلغ به ریال (۱۰ = تومان). */
  moneyToRial?: number;
}

export interface TableReconciliation {
  name: string;
  entity: string;
  rowCount: number;
  validRows: number;
  invalidRows: number;
  duplicateRowsInFile: number;
  unmappedColumns: string[];
  moneyToRial: number;
  totals?: { debit: number; credit: number; difference: number };
  unbalancedVouchers?: number;
  unbalancedSample?: Array<{ voucher: string; difference: number }>;
  warningsFa: string[];
}

export interface ReconciliationReport {
  key: string;
  tables: TableReconciliation[];
  /** جمع همهٔ جدول‌های ترازشونده (روزنامه + افتتاحیه). */
  totals: { debit: number; credit: number; difference: number };
  balanced: boolean;
  blockersFa: string[];
  warningsFa: string[];
}

const DEBIT_CREDIT: Record<string, { debit: string; credit: string }> = {
  'accounting-journal-lines': { debit: 'debitRial', credit: 'creditRial' },
  'accounting-opening-balances': { debit: 'debit', credit: 'credit' },
};

const SAMPLE_LIMIT = 10;

export function selectionKey(selections: ReconcileSelection[]): string {
  const canonical = selections
    .filter((s) => !s.skip)
    .map((s) => ({
      n: s.name,
      e: s.entity,
      m: Object.entries(s.mapping ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      u: s.moneyToRial ?? 1,
    }))
    .sort((a, b) => a.n.localeCompare(b.n));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

export function reconcilePackage(
  tables: PackageTableReader[],
  analysis: PackageAnalysis | undefined,
  adapters: EntityImportAdapter[],
  selections: ReconcileSelection[],
): ReconciliationReport {
  const result: TableReconciliation[] = [];
  const blockersFa: string[] = [];
  const warningsFa: string[] = [];
  let debit = 0;
  let credit = 0;

  for (const selection of selections.filter((s) => !s.skip)) {
    const table = tables.find((t) => t.name === selection.name);
    const adapter = adapters.find((a) => a.key === selection.entity);
    if (!table || !adapter) {
      warningsFa.push(`جدول یا موجودیت «${selection.name}» برای مغایرت‌گیری یافت نشد.`);
      continue;
    }
    const mapping = concreteMapping(
      adapter,
      selection.mapping,
      analysis?.tables.find((t) => t.name === selection.name)?.mapping ?? {},
    );
    const moneyToRial = selection.moneyToRial && selection.moneyToRial > 0 ? selection.moneyToRial : 1;
    const { records, invalidRows } = buildRecords(adapter, table, mapping, { moneyToRial });

    const mappedColumns = new Set(Object.keys(mapping));
    const unmappedColumns = table.columns.map((c) => c.name).filter((name) => !mappedColumns.has(name));

    const seen = new Set<string>();
    let duplicates = 0;
    for (const record of records) {
      const keys = adapter.duplicateKeys(record);
      if (keys.length > 0 && keys.some((k) => seen.has(k))) {
        duplicates += 1;
      }
      keys.forEach((k) => seen.add(k));
    }

    const row: TableReconciliation = {
      name: table.name,
      entity: adapter.key,
      rowCount: table.rowCount,
      validRows: records.length,
      invalidRows,
      duplicateRowsInFile: duplicates,
      unmappedColumns,
      moneyToRial,
      warningsFa: [],
    };

    const fields = DEBIT_CREDIT[adapter.key];
    if (fields) {
      let d = 0;
      let c = 0;
      const perVoucher = new Map<string, number>();
      for (const record of records) {
        const dv = typeof record.values[fields.debit] === 'number' ? (record.values[fields.debit] as number) : 0;
        const cv = typeof record.values[fields.credit] === 'number' ? (record.values[fields.credit] as number) : 0;
        d += dv;
        c += cv;
        if (adapter.key === 'accounting-journal-lines') {
          const voucher = String(record.values.voucherNo ?? '');
          perVoucher.set(voucher, (perVoucher.get(voucher) ?? 0) + dv - cv);
        }
      }
      row.totals = { debit: d, credit: c, difference: d - c };
      debit += d;
      credit += c;
      if (adapter.key === 'accounting-journal-lines') {
        const bad = [...perVoucher.entries()].filter(([, diff]) => diff !== 0);
        row.unbalancedVouchers = bad.length;
        row.unbalancedSample = bad.slice(0, SAMPLE_LIMIT).map(([voucher, difference]) => ({ voucher, difference }));
        if (bad.length > 0) {
          blockersFa.push(`در «${table.name}» ${bad.length} سند تراز نیست (جمع بدهکار ≠ جمع بستانکار).`);
        }
      }
      if (d !== c) {
        blockersFa.push(
          `جمع بدهکار و بستانکار «${table.name}» برابر نیست (اختلاف ${Math.abs(d - c).toLocaleString('en-US')} ریال).`,
        );
      }
    }

    const tableAnalysis = analysis?.tables.find((t) => t.name === selection.name);
    if (tableAnalysis?.moneyUnit?.unit === 'unknown' && Object.values(mapping).some((f) => adapter.fields.find((x) => x.key === f)?.type === 'money') && moneyToRial === 1) {
      row.warningsFa.push('واحد مبلغ (ریال یا تومان) در فایل مشخص نیست؛ به‌صورت ریال فرض شد. اگر تومان است، واحد را در پیش‌نمایش انتخاب کنید.');
    }
    if (invalidRows > 0) {
      row.warningsFa.push(`${invalidRows} ردیف نامعتبر است و ثبت نخواهد شد.`);
    }
    if (duplicates > 0) {
      row.warningsFa.push(`${duplicates} ردیف تکراری داخل همین فایل است و فقط یکی ثبت می‌شود.`);
    }
    result.push(row);
  }

  const balanced = blockersFa.length === 0;
  return {
    key: selectionKey(selections),
    tables: result,
    totals: { debit, credit, difference: debit - credit },
    balanced,
    blockersFa,
    warningsFa: [...warningsFa, ...result.flatMap((t) => t.warningsFa.map((w) => `«${t.name}»: ${w}`))],
  };
}
