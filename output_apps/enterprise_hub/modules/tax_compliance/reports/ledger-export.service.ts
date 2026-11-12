import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { minorToDecimal, minorToMillionRials, roundMinorHalfUp } from '../../accounting/money';
import { AuditService } from '../../access/services/audit.service';
import { tehranMidnight } from '../../assistant/services/jalali-period';
import { isoDate, jalaliMonthDays, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';
import { ElectronicBooksFormat, QueryElectronicBooksDto } from '../dto/query-electronic-books.dto';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { toCsv } from './csv.util';
import {
  AUDIT_ACTION_ELECTRONIC_BOOKS_EXPORT,
  DEFAULT_ROUNDING_ACCOUNT_CODE,
  DEFAULT_ROUNDING_ACCOUNT_NAME,
  DEFAULT_ROUNDING_KOL_CODE,
  DEFAULT_ROUNDING_KOL_NAME,
  ELECTRONIC_BOOKS_CSV_MAX_BYTES,
  ELECTRONIC_BOOKS_LAYOUT_STATUS,
  ELECTRONIC_BOOKS_XLSX_ROW_LIMIT,
  ElectronicBooksUnit,
  ElectronicBooksVoucherScope,
  getElectronicBooksHeaders,
  OFFICIAL_ELECTRONIC_BOOKS_HEADERS,
} from './electronic-books.constants';
import {
  ElectronicBookRowValues,
  writeElectronicBooksXlsx,
} from './electronic-books-xlsx.util';
import { formatJalaliYmd, tehranDay } from './jalali-format.util';
import { AccountTurnoverGroup, ExportLine, LedgerExportRepository } from './ledger-export.repository';

export { ELECTRONIC_BOOKS_LAYOUT_STATUS, OFFICIAL_ELECTRONIC_BOOKS_HEADERS };

/**
 * The legacy layout of journal and ledger CSV is unverified against official portal schemas.
 * Electronic commercial books (`electronicBooksXlsx`, `electronicBooksCsv`, `electronicBooksAuto`)
 * match `docs/tax/official/electronic-books-template.xlsx` headers and remain flagged `unverified`
 * until live upload confirms portal rounding and unit behaviour on my.tax.gov.ir.
 */
export const LEDGER_EXPORT_LAYOUT_STATUS = 'unverified' as const;

export interface ElectronicBooksBounds {
  fromDay: string;
  toDay: string;
  label: string;
  endDateJalali: string;
  periodicityMonths: number;
}

export interface ElectronicBooksPresetItem {
  key: string;
  label: string;
  year: number;
  quarter?: number;
  month?: number;
  half?: number;
  fromDay: string;
  toDay: string;
  endDateJalali: string;
  alreadyExported: boolean;
  lastExportedAt?: string;
}

export interface ElectronicBooksPresetsResponse {
  year: number;
  periodicityMonths: number;
  lastExportedEndDate: string | null;
  presets: ElectronicBooksPresetItem[];
}

export interface TurnoverExportResult {
  rows: ElectronicBookRowValues[];
  headers: readonly string[];
  unit: ElectronicBooksUnit;
  voucherScope: ElectronicBooksVoucherScope;
  monthlyAggregate: boolean;
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
  roundingDifference: bigint;
  alreadyExported: boolean;
  lastExportedEndDate: string | null;
  warnings: string[];
  bounds: ElectronicBooksBounds;
}

export interface ElectronicBooksAutoFile {
  format: 'xlsx' | 'csv';
  filename: string;
  contentType: string;
  data: Buffer | string;
  meta: TurnoverExportResult;
}

export const JOURNAL_HEADERS = [
  'شماره سند',
  'تاریخ سند (شمسی)',
  'ردیف',
  'کد حساب',
  'نام حساب',
  'شرح',
  'کد طرف حساب',
  'بدهکار (ریال)',
  'بستانکار (ریال)',
] as const;

export const LEDGER_HEADERS = [
  'کد حساب',
  'نام حساب',
  'شماره سند',
  'تاریخ سند (شمسی)',
  'ردیف',
  'شرح',
  'بدهکار (ریال)',
  'بستانکار (ریال)',
  'مانده (ریال، بدهکار مثبت)',
] as const;

@Injectable()
export class LedgerExportService {
  constructor(
    private readonly repository: LedgerExportRepository,
    @Optional() private readonly statutory?: StatutoryRepository,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private bounds(year: number, quarter: number): { fromDay: string; toDay: string } {
    const range = jalaliQuarterRange(year, quarter);
    return { fromDay: tehranDay(range.from), toDay: tehranDay(range.to) };
  }

  private jalaliEndYmd(year: number, month: number): string {
    const days = jalaliMonthDays(year, month);
    return `${year}/${String(month).padStart(2, '0')}/${String(days).padStart(2, '0')}`;
  }

  /**
   * Default electronic commercial books periodicity by Jalali fiscal year:
   * 1404 and earlier = 6-month (half-yearly), 1405 = 3-month (quarterly), 1406+ = 1-month (monthly).
   */
  defaultPeriodicityMonths(year: number): 1 | 3 | 6 {
    if (year <= 1404) return 6;
    if (year === 1405) return 3;
    return 1;
  }

  /** Resolves upload periodicity (months) from statutory settings without swallowing repository failures. */
  async resolvePeriodicityMonths(tenantId: string, year: number): Promise<number> {
    const fallback = this.defaultPeriodicityMonths(year);
    if (!this.statutory) return fallback;
    const rows = await this.statutory.findForYear(tenantId, IRAN, year);
    const resolved = resolveParameters(rows, isoDate(jalaliMonthEnd(year, 12)));
    const param = resolved.get('commercial_books_periodicity');
    if (param && typeof param.value === 'number' && [1, 3, 6, 12].includes(param.value)) {
      return param.value;
    }
    return fallback;
  }

  /** Resolves Tehran day bounds for statutory commercial books export; omitted sub-period covers the full Jalali year. */
  async resolveElectronicBooksBounds(
    tenantId: string,
    query: QueryElectronicBooksDto,
  ): Promise<ElectronicBooksBounds> {
    const year = query.year;
    const selectedCount = [query.month, query.quarter, query.half].filter((v) => v !== undefined).length;
    if (selectedCount > 1) {
      throw new BadRequestException(
        'تنها یکی از پارامترهای ماه، فصل یا دوره شش‌ماهه می‌تواند مشخص شود.',
      );
    }

    const periodicityMonths = await this.resolvePeriodicityMonths(tenantId, year);

    if (query.month) {
      const from = tehranMidnight(year, query.month, 1);
      const to =
        query.month === 12
          ? tehranMidnight(year + 1, 1, 1)
          : tehranMidnight(year, query.month + 1, 1);
      return {
        fromDay: tehranDay(from),
        toDay: tehranDay(to),
        label: `${year}/${String(query.month).padStart(2, '0')}`,
        endDateJalali: this.jalaliEndYmd(year, query.month),
        periodicityMonths,
      };
    }
    if (query.half) {
      const from = query.half === 1 ? tehranMidnight(year, 1, 1) : tehranMidnight(year, 7, 1);
      const to = query.half === 1 ? tehranMidnight(year, 7, 1) : tehranMidnight(year + 1, 1, 1);
      const endMonth = query.half === 1 ? 6 : 12;
      return {
        fromDay: tehranDay(from),
        toDay: tehranDay(to),
        label: `${year}-H${query.half}`,
        endDateJalali: this.jalaliEndYmd(year, endMonth),
        periodicityMonths,
      };
    }
    if (query.quarter) {
      const range = jalaliQuarterRange(year, query.quarter);
      return {
        fromDay: tehranDay(range.from),
        toDay: tehranDay(range.to),
        label: `${year}-Q${query.quarter}`,
        endDateJalali: this.jalaliEndYmd(year, query.quarter * 3),
        periodicityMonths,
      };
    }

    const from = tehranMidnight(year, 1, 1);
    const to = tehranMidnight(year + 1, 1, 1);
    return {
      fromDay: tehranDay(from),
      toDay: tehranDay(to),
      label: `${year}`,
      endDateJalali: this.jalaliEndYmd(year, 12),
      periodicityMonths,
    };
  }

  private async getPriorExportRecords(tenantId: string): Promise<
    Array<{
      fromDay: string;
      toDay: string;
      endDateJalali: string;
      label: string;
      createdAt: string;
    }>
  > {
    if (!this.audit) return [];
    const logs = await this.audit.list(tenantId, {
      limit: 100,
      action: AUDIT_ACTION_ELECTRONIC_BOOKS_EXPORT,
    });
    const entries: Array<{
      fromDay: string;
      toDay: string;
      endDateJalali: string;
      label: string;
      createdAt: string;
    }> = [];
    for (const log of logs) {
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.fromDay === 'string' && typeof meta.toDay === 'string') {
        entries.push({
          fromDay: meta.fromDay,
          toDay: meta.toDay,
          endDateJalali:
            typeof meta.endDateJalali === 'string' ? meta.endDateJalali : String(meta.toDay),
          label: typeof meta.label === 'string' ? meta.label : '',
          createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt ?? ''),
        });
      }
    }
    return entries;
  }

  /** Lists statutory upload presets for a Jalali year along with prior export history warnings. */
  async getElectronicBooksPresets(
    tenantId: string,
    year: number,
  ): Promise<ElectronicBooksPresetsResponse> {
    const periodicityMonths = await this.resolvePeriodicityMonths(tenantId, year);
    const history = await this.getPriorExportRecords(tenantId);

    let lastExportedEndDate: string | null = null;
    let maxToDay = '';
    for (const item of history) {
      if (item.toDay > maxToDay) {
        maxToDay = item.toDay;
        lastExportedEndDate = item.endDateJalali;
      }
    }

    const buildPreset = async (
      key: string,
      label: string,
      dto: QueryElectronicBooksDto,
    ): Promise<ElectronicBooksPresetItem> => {
      const b = await this.resolveElectronicBooksBounds(tenantId, dto);
      const match = history.find((h) => h.toDay > b.fromDay && h.fromDay < b.toDay);
      return {
        key,
        label,
        year,
        quarter: dto.quarter,
        month: dto.month,
        half: dto.half,
        fromDay: b.fromDay,
        toDay: b.toDay,
        endDateJalali: b.endDateJalali,
        alreadyExported: Boolean(match),
        lastExportedAt: match?.createdAt,
      };
    };

    const presets: ElectronicBooksPresetItem[] = [];
    if (periodicityMonths === 6) {
      presets.push(await buildPreset(`${year}-H1`, 'شش‌ماهه اول (فروردین تا شهریور)', { year, half: 1 }));
      presets.push(await buildPreset(`${year}-H2`, 'شش‌ماهه دوم (مهر تا اسفند)', { year, half: 2 }));
    } else if (periodicityMonths === 1) {
      const monthNames = [
        'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
        'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
      ];
      for (let m = 1; m <= 12; m += 1) {
        presets.push(await buildPreset(`${year}-M${String(m).padStart(2, '0')}`, monthNames[m - 1], { year, month: m }));
      }
    } else if (periodicityMonths === 12) {
      presets.push(await buildPreset(`${year}`, `کل سال ${year}`, { year }));
    } else {
      const quarterNames = ['بهار (فصل ۱)', 'تابستان (فصل ۲)', 'پاییز (فصل ۳)', 'زمستان (فصل ۴)'];
      for (let q = 1; q <= 4; q += 1) {
        presets.push(await buildPreset(`${year}-Q${q}`, quarterNames[q - 1], { year, quarter: q }));
      }
    }

    return { year, periodicityMonths, lastExportedEndDate, presets };
  }

  private mergeMonthlyGroups(
    groups: AccountTurnoverGroup[],
  ): Array<{
    kolCode: string;
    kolName: string;
    moeinCode: string;
    moeinName: string;
    tafsiliCode: string;
    tafsiliName: string;
    turnoverDateJalali: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }> {
    const merged = new Map<
      string,
      {
        kolCode: string;
        kolName: string;
        moeinCode: string;
        moeinName: string;
        tafsiliCode: string;
        tafsiliName: string;
        turnoverDateJalali: string;
        debitMinor: bigint;
        creditMinor: bigint;
      }
    >();

    for (const g of groups) {
      const jDate = formatJalaliYmd(g.date);
      const [jyStr, jmStr] = jDate.split('/');
      const jy = Number(jyStr);
      const jm = Number(jmStr);
      const endDate = this.jalaliEndYmd(jy, jm);
      const key = `${g.kolCode}|${g.moeinCode}|${endDate}`;
      const existing = merged.get(key) ?? {
        kolCode: g.kolCode,
        kolName: g.kolName,
        moeinCode: g.moeinCode,
        moeinName: g.moeinName,
        tafsiliCode: '',
        tafsiliName: '',
        turnoverDateJalali: endDate,
        debitMinor: 0n,
        creditMinor: 0n,
      };
      existing.debitMinor += g.debitMinor;
      existing.creditMinor += g.creditMinor;
      merged.set(key, existing);
    }

    return [...merged.values()].sort((a, b) =>
      `${a.turnoverDateJalali}|${a.kolCode}|${a.moeinCode}`.localeCompare(
        `${b.turnoverDateJalali}|${b.kolCode}|${b.moeinCode}`,
      ),
    );
  }

  /**
   * Account turnover prepared per official electronic commercial books rules:
   * - Single side per row (never both debit > 0 and credit > 0 in one row)
   * - Configurable unit (`million_rial` half-up to million rials, or `rial` half-up to whole rials)
   * - Explicit rounding-difference adjustment row so totals balance identically after rounding
   * - Separate voucher scopes (`operational`, `opening`, `closing_temp`, `closing_perm`)
   * - Optional monthly aggregation at Moein level dated last day of Jalali month
   */
  async getTurnoverData(
    tenantId: string,
    query: QueryElectronicBooksDto,
  ): Promise<TurnoverExportResult> {
    const bounds = await this.resolveElectronicBooksBounds(tenantId, query);
    const unit: ElectronicBooksUnit = query.unit ?? 'million_rial';
    const voucherScope: ElectronicBooksVoucherScope = query.voucherScope ?? 'operational';
    const monthlyAggregate = Boolean(query.monthlyAggregate);
    const headers = getElectronicBooksHeaders(unit);

    const groups =
      voucherScope === 'operational' && !monthlyAggregate
        ? await this.repository.accountTurnover(tenantId, bounds.fromDay, bounds.toDay)
        : await this.repository.accountTurnover(tenantId, bounds.fromDay, bounds.toDay, {
            voucherScope,
            monthlyAggregate,
          });

    let totalDebitMinor = 0n;
    let totalCreditMinor = 0n;
    for (const g of groups) {
      totalDebitMinor += g.debitMinor;
      totalCreditMinor += g.creditMinor;
    }

    if (totalDebitMinor !== totalCreditMinor) {
      throw new BadRequestException(
        `تراز دفاتر تجاری برقرار نیست: جمع بدهکار (${minorToMillionRials(totalDebitMinor)}) با جمع بستانکار (${minorToMillionRials(totalCreditMinor)}) برابر نیست.`,
      );
    }

    const baseGroups = monthlyAggregate
      ? this.mergeMonthlyGroups(groups)
      : groups.map((g) => ({
          kolCode: g.kolCode,
          kolName: g.kolName,
          moeinCode: g.moeinCode,
          moeinName: g.moeinName,
          tafsiliCode: g.tafsiliCode,
          tafsiliName: g.tafsiliName,
          turnoverDateJalali: formatJalaliYmd(g.date),
          debitMinor: g.debitMinor,
          creditMinor: g.creditMinor,
        }));

    const unitDivisor = unit === 'rial' ? 100n : 100_000_000n;
    const rows: ElectronicBookRowValues[] = [];
    let roundedDebitSum = 0n;
    let roundedCreditSum = 0n;

    for (const g of baseGroups) {
      if (g.debitMinor > 0n) {
        const debitRounded = roundMinorHalfUp(g.debitMinor, unitDivisor);
        roundedDebitSum += debitRounded;
        rows.push([
          g.kolCode,
          g.kolName,
          g.moeinCode,
          g.moeinName,
          g.tafsiliCode,
          g.tafsiliName,
          debitRounded.toString(),
          '0',
          g.turnoverDateJalali,
        ]);
      }
      if (g.creditMinor > 0n) {
        const creditRounded = roundMinorHalfUp(g.creditMinor, unitDivisor);
        roundedCreditSum += creditRounded;
        rows.push([
          g.kolCode,
          g.kolName,
          g.moeinCode,
          g.moeinName,
          g.tafsiliCode,
          g.tafsiliName,
          '0',
          creditRounded.toString(),
          g.turnoverDateJalali,
        ]);
      }
    }

    const roundingDifference = roundedDebitSum - roundedCreditSum;
    const warnings: string[] = [];

    if (roundingDifference !== 0n) {
      const roundingCode = (query.roundingAccountCode ?? DEFAULT_ROUNDING_ACCOUNT_CODE).trim() || DEFAULT_ROUNDING_ACCOUNT_CODE;
      const roundingName = (query.roundingAccountName ?? DEFAULT_ROUNDING_ACCOUNT_NAME).trim() || DEFAULT_ROUNDING_ACCOUNT_NAME;
      const roundingKol = roundingCode.length >= 2 ? roundingCode.slice(0, 2) : DEFAULT_ROUNDING_KOL_CODE;
      const absDiff = roundingDifference > 0n ? roundingDifference : -roundingDifference;

      if (roundingDifference > 0n) {
        rows.push([
          roundingKol,
          DEFAULT_ROUNDING_KOL_NAME,
          roundingCode,
          roundingName,
          '',
          '',
          '0',
          absDiff.toString(),
          bounds.endDateJalali,
        ]);
        roundedCreditSum += absDiff;
      } else {
        rows.push([
          roundingKol,
          DEFAULT_ROUNDING_KOL_NAME,
          roundingCode,
          roundingName,
          '',
          '',
          absDiff.toString(),
          '0',
          bounds.endDateJalali,
        ]);
        roundedDebitSum += absDiff;
      }

      warnings.push(
        `تفاوت گرد کردن (${absDiff.toString()} ${unit === 'rial' ? 'ریال' : 'میلیون ریال'}) در ردیف حساب تعدیل ${roundingCode} (${roundingName}) ثبت شد.`,
      );
    }

    if (roundedDebitSum !== roundedCreditSum) {
      throw new BadRequestException('تراز دفاتر تجاری پس از گرد کردن برقرار نشد.');
    }

    const history = await this.getPriorExportRecords(tenantId);
    let maxToDay = '';
    let lastExportedEndDate: string | null = null;
    for (const item of history) {
      if (item.toDay > maxToDay) {
        maxToDay = item.toDay;
        lastExportedEndDate = item.endDateJalali;
      }
    }
    const overlappingExport = history.find((h) => h.toDay > bounds.fromDay && h.fromDay < bounds.toDay);
    const alreadyExported = Boolean(overlappingExport);
    if (overlappingExport) {
      warnings.push(
        `هشدار: دوره ${bounds.label} یا بخشی از آن قبلاً تا تاریخ ${overlappingExport.endDateJalali} خروجی گرفته شده است.`,
      );
    }

    return {
      rows,
      headers,
      unit,
      voucherScope,
      monthlyAggregate,
      totalDebitMinor,
      totalCreditMinor,
      roundingDifference,
      alreadyExported,
      lastExportedEndDate,
      warnings,
      bounds,
    };
  }

  private async recordExportAudit(
    tenantId: string,
    format: 'xlsx' | 'csv',
    meta: TurnoverExportResult,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      tenantId,
      actorUserId: null,
      action: AUDIT_ACTION_ELECTRONIC_BOOKS_EXPORT,
      resourceType: 'electronic_books',
      resourceId: meta.bounds.label,
      metadata: {
        label: meta.bounds.label,
        fromDay: meta.bounds.fromDay,
        toDay: meta.bounds.toDay,
        endDateJalali: meta.bounds.endDateJalali,
        format,
        unit: meta.unit,
        voucherScope: meta.voucherScope,
        monthlyAggregate: meta.monthlyAggregate,
        rowCount: meta.rows.length,
        roundingDifference: meta.roundingDifference.toString(),
      },
    });
  }

  private encodeCsvChecked(headers: readonly string[], rows: ElectronicBookRowValues[]): string {
    const csv = toCsv([...headers], rows);
    const byteLength = Buffer.byteLength(csv, 'utf8');
    if (byteLength > ELECTRONIC_BOOKS_CSV_MAX_BYTES) {
      throw new BadRequestException(
        'حجم فایل CSV از سقف مجاز ۱۰۰ مگابایت بیشتر است؛ دوره یا سطح تجمیع را تغییر دهید.',
      );
    }
    return csv;
  }

  /** Official electronic commercial books export choosing XLSX (<= 1,000 rows) or CSV (> 1,000 rows) automatically unless format is specified. */
  async electronicBooksAuto(
    tenantId: string,
    query: QueryElectronicBooksDto,
  ): Promise<ElectronicBooksAutoFile> {
    const meta = await this.getTurnoverData(tenantId, query);
    const chosen: 'xlsx' | 'csv' =
      query.format === ElectronicBooksFormat.CSV
        ? 'csv'
        : query.format === ElectronicBooksFormat.XLSX
          ? 'xlsx'
          : meta.rows.length > ELECTRONIC_BOOKS_XLSX_ROW_LIMIT
            ? 'csv'
            : 'xlsx';

    const suffix = `${meta.bounds.label}-${meta.voucherScope}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    if (chosen === 'csv') {
      const csv = this.encodeCsvChecked(meta.headers, meta.rows);
      await this.recordExportAudit(tenantId, 'csv', meta);
      return {
        format: 'csv',
        filename: `electronic-books-${suffix}.csv`,
        contentType: 'text/csv; charset=utf-8',
        data: csv,
        meta,
      };
    }

    const xlsx = writeElectronicBooksXlsx(meta.rows, meta.headers);
    await this.recordExportAudit(tenantId, 'xlsx', meta);
    return {
      format: 'xlsx',
      filename: `electronic-books-${suffix}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: xlsx,
      meta,
    };
  }

  /** Official electronic commercial books export in XLSX matching my.tax.gov.ir template. */
  async electronicBooksXlsx(tenantId: string, query: QueryElectronicBooksDto): Promise<Buffer> {
    const meta = await this.getTurnoverData(tenantId, query);
    const buffer = writeElectronicBooksXlsx(meta.rows, meta.headers);
    await this.recordExportAudit(tenantId, 'xlsx', meta);
    return buffer;
  }

  /** Official electronic commercial books export in CSV UTF-8 with BOM and formula protection. */
  async electronicBooksCsv(tenantId: string, query: QueryElectronicBooksDto): Promise<string> {
    const meta = await this.getTurnoverData(tenantId, query);
    const csv = this.encodeCsvChecked(meta.headers, meta.rows);
    await this.recordExportAudit(tenantId, 'csv', meta);
    return csv;
  }

  /** Electronic journal (دفتر روزنامه): one row per posted line, in date and entry order. */
  async journalCsv(tenantId: string, year: number, quarter: number): Promise<string> {
    const { fromDay, toDay } = this.bounds(year, quarter);
    const lines = await this.repository.lines(tenantId, fromDay, toDay);
    return toCsv(
      [...JOURNAL_HEADERS],
      lines.map((l) => [
        l.entryNumber,
        formatJalaliYmd(l.date),
        l.lineNo,
        l.accountCode,
        l.accountName,
        l.description,
        l.partyCode,
        minorToDecimal(l.debitMinor),
        minorToDecimal(l.creditMinor),
      ]),
    );
  }

  /** Ledger (دفتر کل): per account an opening row, its lines with a running balance. */
  async ledgerCsv(tenantId: string, year: number, quarter: number, accountCode?: string): Promise<string> {
    const { fromDay, toDay } = this.bounds(year, quarter);
    const [lines, opening] = await Promise.all([
      this.repository.lines(tenantId, fromDay, toDay, accountCode),
      this.repository.openingBalances(tenantId, fromDay, accountCode, toDay),
    ]);
    const byAccount = new Map<string, { name: string; lines: ExportLine[] }>();
    for (const line of lines) {
      const group = byAccount.get(line.accountCode) ?? { name: line.accountName, lines: [] };
      group.lines.push(line);
      byAccount.set(line.accountCode, group);
    }
    const codes = [...new Set([...byAccount.keys(), ...opening.keys()])].sort();
    const rows: Array<Array<string | number>> = [];
    for (const code of codes) {
      const group = byAccount.get(code);
      let running = opening.get(code) ?? 0n;
      rows.push([code, group?.name ?? '', '', '', '', 'مانده ابتدای دوره', '', '', minorToDecimal(running)]);
      for (const l of group?.lines ?? []) {
        running += l.debitMinor - l.creditMinor;
        rows.push([
          code,
          l.accountName,
          l.entryNumber,
          formatJalaliYmd(l.date),
          l.lineNo,
          l.description,
          minorToDecimal(l.debitMinor),
          minorToDecimal(l.creditMinor),
          minorToDecimal(running),
        ]);
      }
    }
    return toCsv([...LEDGER_HEADERS], rows);
  }
}
