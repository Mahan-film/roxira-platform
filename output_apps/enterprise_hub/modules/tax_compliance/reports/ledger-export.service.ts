import { Injectable } from '@nestjs/common';
import { minorToDecimal } from '../../accounting/money';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import { toCsv } from './csv.util';
import { formatJalaliYmd, tehranDay } from './jalali-format.util';
import { ExportLine, LedgerExportRepository } from './ledger-export.repository';

/**
 * The official layout of the electronic journal and ledger file is NOT verified against a published
 * tax-authority specification (docs/tax/LEDGER_EXPORT_LAYOUT.md). Columns below are our own.
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
  constructor(private readonly repository: LedgerExportRepository) {}

  private bounds(year: number, quarter: number): { fromDay: string; toDay: string } {
    const range = jalaliQuarterRange(year, quarter);
    return { fromDay: tehranDay(range.from), toDay: tehranDay(range.to) };
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
