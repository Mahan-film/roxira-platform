import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { minorToDecimal, minorToMillionRials } from '../../accounting/money';
import { tehranMidnight } from '../../assistant/services/jalali-period';
import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';
import { QueryElectronicBooksDto } from '../dto/query-electronic-books.dto';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { toCsv } from './csv.util';
import {
  ELECTRONIC_BOOKS_LAYOUT_STATUS,
  OFFICIAL_ELECTRONIC_BOOKS_HEADERS,
} from './electronic-books.constants';
import {
  ElectronicBookRowValues,
  writeElectronicBooksXlsx,
} from './electronic-books-xlsx.util';
import { formatJalaliYmd, tehranDay } from './jalali-format.util';
import { ExportLine, LedgerExportRepository } from './ledger-export.repository';

export { ELECTRONIC_BOOKS_LAYOUT_STATUS, OFFICIAL_ELECTRONIC_BOOKS_HEADERS };

/**
 * The legacy layout of journal and ledger CSV was provisional/unverified.
 * The electronic commercial books export (`electronicBooksXlsx` and `electronicBooksCsv`)
 * is strictly verified against `docs/tax/official/electronic-books-template.xlsx`.
 */
export const LEDGER_EXPORT_LAYOUT_STATUS = 'unverified' as const;

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
  ) {}

  private bounds(year: number, quarter: number): { fromDay: string; toDay: string } {
    const range = jalaliQuarterRange(year, quarter);
    return { fromDay: tehranDay(range.from), toDay: tehranDay(range.to) };
  }

  /** Resolves Tehran day bounds for statutory commercial books export according to query or statutory store. */
  async resolveElectronicBooksBounds(
    tenantId: string,
    query: QueryElectronicBooksDto,
  ): Promise<{ fromDay: string; toDay: string; label: string }> {
    const year = query.year;
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
      };
    }
    if (query.half) {
      const from = query.half === 1 ? tehranMidnight(year, 1, 1) : tehranMidnight(year, 7, 1);
      const to = query.half === 1 ? tehranMidnight(year, 7, 1) : tehranMidnight(year + 1, 1, 1);
      return {
        fromDay: tehranDay(from),
        toDay: tehranDay(to),
        label: `${year}-H${query.half}`,
      };
    }
    if (query.quarter) {
      const range = jalaliQuarterRange(year, query.quarter);
      return {
        fromDay: tehranDay(range.from),
        toDay: tehranDay(range.to),
        label: `${year}-Q${query.quarter}`,
      };
    }

    // Resolve periodicity from statutory store
    let periodicityMonths = 3; // Default quarterly
    if (this.statutory) {
      try {
        const rows = await this.statutory.findForYear(tenantId, IRAN, year);
        const resolved = resolveParameters(rows, isoDate(jalaliMonthEnd(year, 12)));
        const param = resolved.get('commercial_books_periodicity');
        if (param && typeof param.value === 'number' && param.value > 0) {
          periodicityMonths = param.value;
        }
      } catch {
        // Fallback to default
      }
    }

    if (periodicityMonths === 6) {
      // 6-month periodicity (default half 1)
      const from = tehranMidnight(year, 1, 1);
      const to = tehranMidnight(year, 7, 1);
      return { fromDay: tehranDay(from), toDay: tehranDay(to), label: `${year}-H1` };
    }
    if (periodicityMonths === 1) {
      // 1-month periodicity (default month 1)
      const from = tehranMidnight(year, 1, 1);
      const to = tehranMidnight(year, 2, 1);
      return { fromDay: tehranDay(from), toDay: tehranDay(to), label: `${year}-M01` };
    }
    if (periodicityMonths === 12) {
      // Annual
      const from = tehranMidnight(year, 1, 1);
      const to = tehranMidnight(year + 1, 1, 1);
      return { fromDay: tehranDay(from), toDay: tehranDay(to), label: `${year}` };
    }

    // Default quarterly Q1
    const range = jalaliQuarterRange(year, 1);
    return {
      fromDay: tehranDay(range.from),
      toDay: tehranDay(range.to),
      label: `${year}-Q1`,
    };
  }

  /** Account turnover grouped by kol + moein + tafsili + date with exact million rials amounts. */
  async getTurnoverData(
    tenantId: string,
    query: QueryElectronicBooksDto,
  ): Promise<{
    rows: ElectronicBookRowValues[];
    totalDebitMinor: bigint;
    totalCreditMinor: bigint;
    bounds: { fromDay: string; toDay: string; label: string };
  }> {
    const bounds = await this.resolveElectronicBooksBounds(tenantId, query);
    const groups = await this.repository.accountTurnover(tenantId, bounds.fromDay, bounds.toDay);

    let totalDebitMinor = 0n;
    let totalCreditMinor = 0n;

    const rows: ElectronicBookRowValues[] = groups.map((g) => {
      totalDebitMinor += g.debitMinor;
      totalCreditMinor += g.creditMinor;
      return [
        g.kolCode,
        g.kolName,
        g.moeinCode,
        g.moeinName,
        g.tafsiliCode,
        g.tafsiliName,
        minorToMillionRials(g.debitMinor),
        minorToMillionRials(g.creditMinor),
        formatJalaliYmd(g.date),
      ];
    });

    if (totalDebitMinor !== totalCreditMinor) {
      throw new BadRequestException(
        `تراز دفاتر تجاری برقرار نیست: جمع بدهکار (${minorToMillionRials(totalDebitMinor)}) با جمع بستانکار (${minorToMillionRials(totalCreditMinor)}) برابر نیست.`,
      );
    }

    return { rows, totalDebitMinor, totalCreditMinor, bounds };
  }

  /** Official electronic commercial books export in XLSX matching my.tax.gov.ir template. */
  async electronicBooksXlsx(tenantId: string, query: QueryElectronicBooksDto): Promise<Buffer> {
    const { rows } = await this.getTurnoverData(tenantId, query);
    return writeElectronicBooksXlsx(rows);
  }

  /** Official electronic commercial books export in CSV UTF-8 with BOM and formula protection. */
  async electronicBooksCsv(tenantId: string, query: QueryElectronicBooksDto): Promise<string> {
    const { rows } = await this.getTurnoverData(tenantId, query);
    return toCsv([...OFFICIAL_ELECTRONIC_BOOKS_HEADERS], rows);
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
