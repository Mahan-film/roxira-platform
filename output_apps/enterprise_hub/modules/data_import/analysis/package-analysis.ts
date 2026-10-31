/**
 * تحلیل خالص یک بستهٔ دیتابیس: تشخیص موجودیت، نگاشت ستون‌ها، روابط، بررسی‌های
 * سلامت و فهرست ارزها.
 *
 * این تابع‌ها «خالص» و مستقل از Nest هستند تا مستقیماً در تست‌ها روی جداول
 * صفحه‌ای (SQLite/دامپ/ZIP) اجرا شوند و مصرف حافظه با صفحه‌خوانی کران‌دار بماند.
 */

import {
  PACKAGE_COLUMN_SAMPLE,
  PACKAGE_PAGE_SIZE,
  PACKAGE_RELATIONSHIP_THRESHOLD,
  PACKAGE_SAMPLE_ROWS,
} from '../constants/package-import.constants';
import { parseJalaliDate } from '../normaliser/normalise';
import {
  normaliseCurrency,
  looksLikeCurrencyColumn,
} from '../parsers/currency-normalise';
import {
  PackageRelationship,
  PackageTableReader,
  stringifyCell,
} from '../parsers/package-source.types';
import {
  buildEntityFallbackMapping,
  detectEntity,
} from '../registry/entity-detect';
import { EntityImportAdapter } from '../registry/import-registry.types';

export interface PackageColumnAnalysis {
  name: string;
  type: string;
  sample: (string | number | null)[];
}

export interface PackageTableAnalysis {
  name: string;
  rowCount: number;
  columns: PackageColumnAnalysis[];
  detectedEntity: string | null;
  confidence: number;
  mapping: Record<string, string | null>;
  skipped?: boolean;
  reason?: string;
  /** امضای سربرگ‌ها (برای حافظهٔ نگاشت هر مستأجر). */
  signature?: string;
  /** منشأ نگاشت: حدس سربرگ، پیشنهاد خواننده (IIF/OFX)، پروفایل محصول، یا حافظهٔ مستأجر. */
  mappingSource?: 'heuristic' | 'reader' | 'profile' | 'memory';
  profileId?: string;
  profileEvidence?: 'proven' | 'heuristic';
  /** توضیح فارسی منشأ نگاشت یا هشدار پروفایل. */
  notesFa?: string[];
  /** واحد مبلغ تشخیص‌داده‌شده برای ستون‌های پولی نگاشت‌شده؛ `unknown` یعنی باید تأیید شود. */
  moneyUnit?: {
    unit: 'rial' | 'toman' | 'unknown';
    toRial: number | null;
    evidence: string;
    column?: string;
  };
  /** تقویم ستون‌های تاریخ نگاشت‌شده. */
  dateSystem?: 'jalali' | 'gregorian' | 'mixed' | 'unknown';
}

export interface PackageRelationshipAnalysis extends PackageRelationship {
  matchRatio: number;
}

export type PackageHealthLevel = 'ok' | 'warn' | 'error';

export interface PackageHealthCheck {
  key: string;
  level: PackageHealthLevel;
  titleFa: string;
  detailFa: string;
  value?: number;
}

export interface PackageHealth {
  checks: PackageHealthCheck[];
}

export interface PackageCurrencyCount {
  raw: string;
  normalized: string | null;
  count: number;
}

export interface PackageFormatInfo {
  id: string;
  notes: string[];
}

export interface PackageAnalysis {
  /** قالب تشخیص‌داده‌شده از محتوا و یادداشت‌های خواننده (رمزگذاری، اصلاح حروف، دستورهای نادیده‌گرفته‌شده). */
  format?: PackageFormatInfo;
  tables: PackageTableAnalysis[];
  relationships: PackageRelationshipAnalysis[];
  health: PackageHealth;
  currencies: PackageCurrencyCount[];
}

/** جدولی که معاملهٔ ارزی/صرافی است و پیش‌فرض نگاشت نمی‌شود. */
const FX_TABLE_NAME = /(havale|arzi|exchange|\bfx\b)/i;
const FX_COLUMN_HINTS = [
  'saraffi',
  'sarafi',
  'noeamaliat',
  'vazeiatswift',
  'mablaghmoadele',
  'karmozd',
];

/** عبور از همهٔ ردیف‌های یک جدول به‌صورت صفحه‌ای. */
export function* iterateRows(
  table: PackageTableReader,
): Generator<Record<string, unknown>> {
  for (let offset = 0; offset < table.rowCount; offset += PACKAGE_PAGE_SIZE) {
    const rows = table.readPage(offset, PACKAGE_PAGE_SIZE);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      yield row;
    }
  }
}

/** تشخیص جدول معاملهٔ ارزی (FX) با نام/ستون‌های مشخصه. */
export function isFxTable(table: PackageTableReader): boolean {
  if (FX_TABLE_NAME.test(table.name)) {
    return true;
  }
  const columns = table.columns.map((column) => column.name.toLowerCase());
  return FX_COLUMN_HINTS.some((hint) =>
    columns.some((column) => column.includes(hint)),
  );
}

/** تشخیص موجودیت و ساخت نگاشت هر جدول. */
export function analyseTables(
  tables: PackageTableReader[],
  adapters: EntityImportAdapter[],
): PackageTableAnalysis[] {
  return tables.map((table) => {
    const headers = table.columns.map((column) => column.name);
    const samplePage = table.readPage(0, PACKAGE_SAMPLE_ROWS);
    const sampleRows = samplePage.map((row) =>
      headers.map((header) => stringifyCell(row[header])),
    );

    const columns: PackageColumnAnalysis[] = table.columns.map((column) => {
      const sample: (string | number | null)[] = [];
      for (const row of samplePage) {
        const value = row[column.name];
        if (value === null || value === undefined || value === '') {
          continue;
        }
        sample.push(typeof value === 'number' ? value : stringifyCell(value));
        if (sample.length >= PACKAGE_COLUMN_SAMPLE) {
          break;
        }
      }
      return { name: column.name, type: column.type || '', sample };
    });

    if (isFxTable(table)) {
      const mapping: Record<string, string | null> = {};
      for (const header of headers) {
        mapping[header] = null;
      }
      return {
        name: table.name,
        rowCount: table.rowCount,
        columns,
        detectedEntity: null,
        confidence: 0,
        mapping,
        reason:
          'این جدول معاملات ارزی (FX) است؛ به‌صورت پیش‌فرض نگاشت نمی‌شود مگر خودتان موجودیت مقصد را انتخاب کنید.',
      };
    }

    const detection = detectEntity(headers, adapters);
    if (detection.key && detection.confidence > 0) {
      const adapter =
        adapters.find((item) => item.key === detection.key) ?? null;
      const mapping: Record<string, string | null> = {};
      if (adapter) {
        const fallback = buildEntityFallbackMapping(adapter.fields, headers);
        for (const header of headers) {
          mapping[header] = fallback[header] ?? null;
        }
      } else {
        for (const header of headers) {
          mapping[header] = null;
        }
      }
      return {
        name: table.name,
        rowCount: table.rowCount,
        columns,
        detectedEntity: detection.key,
        confidence: detection.confidence,
        mapping,
      };
    }

    const mapping: Record<string, string | null> = {};
    for (const header of headers) {
      mapping[header] = null;
    }
    return {
      name: table.name,
      rowCount: table.rowCount,
      columns,
      detectedEntity: null,
      confidence: 0,
      mapping,
      reason: 'ستون‌های این جدول با هیچ موجودیت شناخته‌شده‌ای تطبیق نشد.',
    };
  });
}

/** آمار ستون‌های کلیدمانند (مقادیر یکتا و تعداد پرشده). */
export interface ColumnStats {
  values: Set<string>;
  nonEmpty: number;
}

/** آیا نام ستون، کلیدمانند است (کد/شناسه/طرف حساب/…)? */
export function looksLikeKeyColumn(name: string): boolean {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    /(code|tafzili|party|hesab|shomare|number|account|ref|serial|id)$/.test(
      compact,
    ) && compact.length > 1
  );
}

const MAX_KEY_SET = 200000;

/** جمع‌آوری مقادیر یکتای ستون‌های کلیدمانند هر جدول. */
export function collectKeyColumnStats(
  tables: PackageTableReader[],
): Map<string, Map<string, ColumnStats>> {
  const result = new Map<string, Map<string, ColumnStats>>();

  for (const table of tables) {
    const keyColumns = table.columns
      .map((column) => column.name)
      .filter(looksLikeKeyColumn);
    if (keyColumns.length === 0) {
      continue;
    }
    const stats = new Map<string, ColumnStats>();
    for (const column of keyColumns) {
      stats.set(column, { values: new Set<string>(), nonEmpty: 0 });
    }

    for (const row of iterateRows(table)) {
      for (const column of keyColumns) {
        const value = stringifyCell(row[column]).trim();
        if (!value) {
          continue;
        }
        const stat = stats.get(column)!;
        stat.nonEmpty += 1;
        if (stat.values.size < MAX_KEY_SET) {
          stat.values.add(value);
        }
      }
    }

    result.set(table.name, stats);
  }

  return result;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** True when the values are exactly the integers 1..N (an auto-increment row id). */
function isDenseRowNumber(values: Set<string>): boolean {
  if (values.size === 0) {
    return false;
  }
  let max = 0;
  for (const value of values) {
    if (!/^[1-9][0-9]*$/.test(value)) {
      return false;
    }
    max = Math.max(max, Number(value));
  }
  return max === values.size;
}

/** استنباط روابط بین جداول بر پایه پوشش مقادیر کلید. */
export function analyseRelationships(
  tables: PackageTableReader[],
  declared: PackageRelationship[],
  stats: Map<string, Map<string, ColumnStats>> = collectKeyColumnStats(
    tables,
  ),
): {
  relationships: PackageRelationshipAnalysis[];
  dangling: number;
} {
  const relationships: PackageRelationshipAnalysis[] = [];
  const seen = new Set<string>();
  let dangling = 0;

  for (const parent of tables) {
    const parentStats = stats.get(parent.name);
    if (!parentStats) {
      continue;
    }
    for (const [parentColumn, parentStat] of parentStats) {
      if (parentStat.nonEmpty === 0) {
        continue;
      }
      const uniqueness = parentStat.values.size / parentStat.nonEmpty;
      if (uniqueness < PACKAGE_RELATIONSHIP_THRESHOLD) {
        continue;
      }
      const parentIsRowNumber = isDenseRowNumber(parentStat.values);
      for (const child of tables) {
        if (child.name === parent.name) {
          continue;
        }
        const childStats = stats.get(child.name);
        if (!childStats) {
          continue;
        }
        for (const [childColumn, childStat] of childStats) {
          // Same-named columns (TafziliCode -> TafziliCode) are the most common real link.
          if (childStat.values.size === 0) {
            continue;
          }
          // A 1..N auto-increment id overlaps every other small integer column (PartyID vs
          // ActivityID); only trust it when the column names match.
          if (parentIsRowNumber && childColumn !== parentColumn) {
            continue;
          }
          let covered = 0;
          for (const value of childStat.values) {
            if (parentStat.values.has(value)) {
              covered += 1;
            }
          }
          const ratio = covered / childStat.values.size;
          if (ratio < PACKAGE_RELATIONSHIP_THRESHOLD) {
            continue;
          }
          // Two unique, differently named columns overlapping is usually two auto-increment ids
          // (HavaleID vs FactorID), not a reference: a real foreign key repeats in the child.
          const childUnique =
            childStat.nonEmpty > 0 &&
            childStat.values.size / childStat.nonEmpty >= PACKAGE_RELATIONSHIP_THRESHOLD;
          if (childUnique && childColumn !== parentColumn) {
            continue;
          }
          const id = `${child.name}.${childColumn}->${parent.name}.${parentColumn}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          relationships.push({
            fromTable: child.name,
            fromColumn: childColumn,
            toTable: parent.name,
            toColumn: parentColumn,
            declared: false,
            matchRatio: round4(ratio),
          });
          // distinct child values with no parent (covered counts distinct values too)
          dangling += childStat.values.size - covered;
        }
      }
    }
  }

  for (const relation of declared) {
    const id = `${relation.fromTable}.${relation.fromColumn}->${relation.toTable}.${relation.toColumn}`;
    const existing = relationships.find(
      (item) =>
        `${item.fromTable}.${item.fromColumn}->${item.toTable}.${item.toColumn}` ===
        id,
    );
    if (existing) {
      existing.declared = true;
    } else {
      relationships.push({ ...relation, matchRatio: 1 });
    }
  }

  return { relationships, dangling };
}

/** ستون‌هایی که به فیلد تاریخ نگاشت شده‌اند. */
function dateColumnsOf(
  table: PackageTableReader,
  analysis: PackageTableAnalysis,
): string[] {
  const columns = table.columns.map((column) => column.name);
  const mapped = columns.filter(
    (column) => analysis.mapping[column] === 'date',
  );
  if (mapped.length > 0) {
    return mapped;
  }
  return columns.filter((column) => /(tarikh|date|tavalod|tärikh)/i.test(column));
}

/** ستون‌های ارزی (نگاشت‌شده به currency یا نام ارزی). */
function currencyColumnsOf(
  table: PackageTableReader,
  analysis: PackageTableAnalysis,
): string[] {
  return table.columns
    .map((column) => column.name)
    .filter(
      (column) =>
        analysis.mapping[column] === 'currency' ||
        looksLikeCurrencyColumn(column),
    );
}

/** فهرست ستون‌های تومانی و معادل ریالی آن‌ها در یک جدول. */
function tomanRialPairs(
  table: PackageTableReader,
): Array<{ toman: string; rial: string }> {
  const names = table.columns.map((column) => column.name);
  const pairs: Array<{ toman: string; rial: string }> = [];
  for (const name of names) {
    if (!/toman/i.test(name)) {
      continue;
    }
    const rialName = name.replace(/toman/i, 'rial');
    const match = names.find(
      (candidate) => candidate.toLowerCase() === rialName.toLowerCase(),
    );
    if (match) {
      pairs.push({ toman: name, rial: match });
    }
  }
  return pairs;
}

const NATURAL_KEYS: Record<string, string[]> = {
  'accounting-accounts': ['code'],
  'inventory-items': ['sku'],
  'sales-invoices': ['number'],
  'crm-leads': ['email'],
};

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** اجرای همهٔ بررسی‌های سلامت پیش از commit. */
export function runHealthChecks(
  tables: PackageTableReader[],
  tableAnalyses: PackageTableAnalysis[],
  relationships: PackageRelationshipAnalysis[],
  stats: Map<string, Map<string, ColumnStats>> = collectKeyColumnStats(
    tables,
  ),
): PackageHealth {
  let totalDebit = 0;
  let totalCredit = 0;
  let fxChecked = 0;
  let fxMismatch = 0;
  let tomanChecked = 0;
  let tomanMismatch = 0;
  let invalidDates = 0;
  let unknownCurrencies = 0;
  let duplicateKeys = 0;
  const unbalancedVouchers = new Set<string>();

  tables.forEach((table, index) => {
    const analysis = tableAnalyses[index];
    const columnsInverse = new Map<string, string>();
    for (const [column, field] of Object.entries(analysis.mapping)) {
      if (field && !columnsInverse.has(field)) {
        columnsInverse.set(field, column);
      }
    }

    const dateColumns = analysis.detectedEntity
      ? dateColumnsOf(table, analysis)
      : [];
    const currencyColumns = analysis.detectedEntity
      ? currencyColumnsOf(table, analysis)
      : [];
    const pairs = analysis.detectedEntity ? tomanRialPairs(table) : [];

    const isJournalLines = analysis.detectedEntity === 'accounting-journal-lines';
    const voucherColumn = isJournalLines
      ? columnsInverse.get('voucherNo')
      : undefined;
    const debitColumn = isJournalLines
      ? columnsInverse.get('debitRial')
      : undefined;
    const creditColumn = isJournalLines
      ? columnsInverse.get('creditRial')
      : undefined;
    const amountFxColumn = isJournalLines
      ? columnsInverse.get('amountFx')
      : undefined;
    const fxRateColumn = isJournalLines
      ? columnsInverse.get('fxRate')
      : undefined;

    const voucherTotals = new Map<string, { debit: number; credit: number }>();

    for (const row of iterateRows(table)) {
      if (isJournalLines && debitColumn && creditColumn) {
        const debit = numericValue(row[debitColumn]) ?? 0;
        const credit = numericValue(row[creditColumn]) ?? 0;
        totalDebit += debit;
        totalCredit += credit;

        if (voucherColumn) {
          const voucher = stringifyCell(row[voucherColumn]).trim();
          if (voucher) {
            const current = voucherTotals.get(voucher) ?? {
              debit: 0,
              credit: 0,
            };
            current.debit += debit;
            current.credit += credit;
            voucherTotals.set(voucher, current);
          }
        }

        if (amountFxColumn && fxRateColumn) {
          const amountFx = numericValue(row[amountFxColumn]);
          const fxRate = numericValue(row[fxRateColumn]);
          const rial = debit + credit;
          if (amountFx !== null && fxRate !== null && rial > 0) {
            fxChecked += 1;
            const expected = amountFx * fxRate;
            const tolerance = Math.max(1, rial * 0.005);
            if (Math.abs(expected - rial) > tolerance) {
              fxMismatch += 1;
            }
          }
        }
      }

      for (const column of dateColumns) {
        const value = stringifyCell(row[column]).trim();
        if (value && parseJalaliDate(value) === null) {
          invalidDates += 1;
        }
      }

      for (const column of currencyColumns) {
        const value = stringifyCell(row[column]).trim();
        if (value && normaliseCurrency(value) === null) {
          unknownCurrencies += 1;
        }
      }

      for (const pair of pairs) {
        const toman = numericValue(row[pair.toman]);
        const rial = numericValue(row[pair.rial]);
        if (toman !== null && rial !== null) {
          tomanChecked += 1;
          // Toman is usually rounded from rial, so up to half a toman (5 rial) is not a mismatch.
          if (Math.abs(rial - toman * 10) > 5) {
            tomanMismatch += 1;
          }
        }
      }
    }

    // شناسایی اسناد ناتراز.
    for (const [voucher, totals] of voucherTotals) {
      if (Math.abs(totals.debit - totals.credit) >= 1) {
        unbalancedVouchers.add(voucher);
      }
    }

    // کلیدهای تکراری طبیعی.
    const naturalKeyFields = NATURAL_KEYS[analysis.detectedEntity ?? ''];
    if (naturalKeyFields) {
      const tableStats = stats.get(table.name);
      if (tableStats) {
        for (const field of naturalKeyFields) {
          const column = columnsInverse.get(field);
          if (!column) {
            continue;
          }
          const stat = tableStats.get(column);
          if (stat) {
            duplicateKeys += Math.max(0, stat.nonEmpty - stat.values.size);
          }
        }
      }
    }
  });

  const dangling = relationships.reduce((sum, item) => {
    if (item.declared) {
      return sum;
    }
    const tableStats = stats.get(item.fromTable);
    const stat = tableStats?.get(item.fromColumn);
    if (!stat) {
      return sum;
    }
    const parentStat = stats.get(item.toTable)?.get(item.toColumn);
    if (!parentStat) {
      return sum;
    }
    let covered = 0;
    for (const value of stat.values) {
      if (parentStat.values.has(value)) {
        covered += 1;
      }
    }
    return sum + (stat.values.size - covered); // distinct unmatched values, like `covered`
  }, 0);

  const balanceDiff = Math.abs(totalDebit - totalCredit);
  const checks: PackageHealthCheck[] = [
    {
      key: 'voucher-balance',
      level: unbalancedVouchers.size > 0 ? 'error' : 'ok',
      titleFa: 'تراز هر سند',
      detailFa:
        unbalancedVouchers.size > 0
          ? `${unbalancedVouchers.size} سند ناتراز یافت شد.`
          : 'همهٔ اسناد تراز هستند.',
      value: unbalancedVouchers.size,
    },
    {
      key: 'total-debit-credit',
      level: balanceDiff >= 1 ? 'error' : 'ok',
      titleFa: 'جمع کل بدهکار و بستانکار',
      detailFa:
        balanceDiff >= 1
          ? `اختلاف جمع بدهکار و بستانکار: ${Math.round(balanceDiff)} ریال.`
          : 'جمع بدهکار با جمع بستانکار برابر است.',
      value: Math.round(balanceDiff),
    },
    {
      key: 'fx-formula',
      level: fxMismatch > 0 ? 'warn' : 'ok',
      titleFa: 'فرمول ارز (مبلغ ارزی × نرخ)',
      detailFa:
        fxChecked === 0
          ? 'ردیف ارزی برای بررسی یافت نشد.'
          : fxMismatch > 0
            ? `${fxMismatch} ردیف با فرمول مبلغ ارزی × نرخ نمی‌خواند.`
            : 'همهٔ ردیف‌های ارزی با فرمول می‌خوانند.',
      value: fxMismatch,
    },
    {
      key: 'toman-rial',
      level: tomanMismatch > 0 ? 'warn' : 'ok',
      titleFa: 'تومان = ریال ÷ ۱۰',
      detailFa:
        tomanChecked === 0
          ? 'ستون تومانی برای بررسی یافت نشد.'
          : tomanMismatch > 0
            ? `${tomanMismatch} ردیف نسبت تومان/ریال نادرست دارد.`
            : 'نسبت تومان به ریال درست است.',
      value: tomanMismatch,
    },
    {
      key: 'dangling-references',
      level: dangling > 0 ? 'warn' : 'ok',
      titleFa: 'ارجاع‌های بین جداول',
      detailFa:
        dangling > 0
          ? `${dangling} مقدار ارجاعی بدون طرف مقابل است.`
          : 'هیچ ارجاع آزادی یافت نشد.',
      value: dangling,
    },
    {
      key: 'unknown-currencies',
      level: unknownCurrencies > 0 ? 'warn' : 'ok',
      titleFa: 'ارزهای ناشناخته',
      detailFa:
        unknownCurrencies > 0
          ? `${unknownCurrencies} مقدار ارزی ناشناخته است.`
          : 'همهٔ ارزها شناخته‌شده هستند.',
      value: unknownCurrencies,
    },
    {
      key: 'jalali-dates',
      level: invalidDates > 0 ? 'warn' : 'ok',
      titleFa: 'اعتبار تاریخ‌های جلالی',
      detailFa:
        invalidDates > 0
          ? `${invalidDates} تاریخ نامعتبر است.`
          : 'همهٔ تاریخ‌ها معتبر هستند.',
      value: invalidDates,
    },
    {
      key: 'duplicate-natural-keys',
      level: duplicateKeys > 0 ? 'warn' : 'ok',
      titleFa: 'کلیدهای تکراری',
      detailFa:
        duplicateKeys > 0
          ? `${duplicateKeys} کلید تکراری یافت شد.`
          : 'هیچ کلید تکراری یافت نشد.',
      value: duplicateKeys,
    },
  ];

  return { checks };
}

/** جمع‌آوری فهرست ارزها به همراه شمارش هر مقدار خام. */
export function collectCurrencies(
  tables: PackageTableReader[],
  tableAnalyses: PackageTableAnalysis[],
): PackageCurrencyCount[] {
  const counts = new Map<string, number>();

  tables.forEach((table, index) => {
    const analysis = tableAnalyses[index];
    const columns = currencyColumnsOf(table, analysis);
    if (columns.length === 0) {
      return;
    }
    for (const row of iterateRows(table)) {
      for (const column of columns) {
        const raw = stringifyCell(row[column]).trim();
        if (!raw) {
          continue;
        }
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    }
  });

  return Array.from(counts.entries())
    .map(([raw, count]) => ({
      raw,
      normalized: normaliseCurrency(raw),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
}

/** تحلیل کامل بسته: جدول‌ها، روابط، سلامت و ارزها. */
export function analysePackage(
  tables: PackageTableReader[],
  adapters: EntityImportAdapter[],
  declared: PackageRelationship[] = [],
): PackageAnalysis {
  const tableAnalyses = analyseTables(tables, adapters);
  const stats = collectKeyColumnStats(tables);
  const { relationships } = analyseRelationships(tables, declared, stats);
  const health = runHealthChecks(tables, tableAnalyses, relationships, stats);
  const currencies = collectCurrencies(tables, tableAnalyses);
  return { tables: tableAnalyses, relationships, health, currencies };
}
