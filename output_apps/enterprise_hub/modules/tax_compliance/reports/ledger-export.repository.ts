import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../../accounting/money';

/** Hard cap so one export cannot exhaust memory; the user narrows the season or the account. */
export const LEDGER_EXPORT_MAX_ROWS = 200_000;

export interface ExportLine {
  entryNumber: string;
  date: Date;
  lineNo: number;
  accountCode: string;
  accountName: string;
  description: string;
  partyCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
}

interface RawLine {
  entryNumber: string;
  date: Date;
  lineNo: string;
  accountCode: string;
  accountName: string;
  description: string | null;
  partyCode: string | null;
  debit: string;
  credit: string;
}

/**
 * Read-only journal access for the tax-system export. POSTED entries only, and never the year-end
 * closing pair or the automatic opening pair (same rule as the accounting reports).
 */
@Injectable()
export class LedgerExportRepository {
  constructor(private readonly scope: TenantScope) {}

  async lines(
    tenantId: string,
    fromDay: string,
    toDay: string,
    accountCode?: string,
  ): Promise<ExportLine[]> {
    const rows: RawLine[] = await this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT e.entry_number AS "entryNumber", e.date AS "date",
                ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY l.id) AS "lineNo",
                a.code AS "accountCode", a.name AS "accountName",
                COALESCE(l.description, e.description) AS "description",
                l.party_code AS "partyCode", l.debit AS "debit", l.credit AS "credit"
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND e.status = 'POSTED'
            AND e.entry_type NOT IN ('CLOSING_PERM', 'OPENING_AUTO')
            AND NOT (e.entry_type = 'OPENING' OR (e.entry_type = 'NORMAL' AND e.entry_number LIKE 'OB-%'))
            AND CAST(e.date AS date) >= $2 AND CAST(e.date AS date) < $3
            AND ($4::text IS NULL OR a.code = $4)
          ORDER BY e.date, e.id, l.id
          LIMIT ${LEDGER_EXPORT_MAX_ROWS + 1}`,
        [tenantId, fromDay, toDay, accountCode ?? null],
      ),
    );
    if (rows.length > LEDGER_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `تعداد ردیف‌ها از ${LEDGER_EXPORT_MAX_ROWS} بیشتر است؛ فصل یا حساب را محدودتر کنید.`,
      );
    }
    return rows.map((r) => ({
      entryNumber: r.entryNumber,
      date: new Date(r.date),
      lineNo: Number(r.lineNo),
      accountCode: r.accountCode,
      accountName: r.accountName,
      description: r.description ?? '',
      partyCode: r.partyCode ?? '',
      debitMinor: fromDb(r.debit),
      creditMinor: fromDb(r.credit),
    }));
  }

  /**
   * Debit minus credit of every account before `fromDay`, plus opening entries (`OB-` imports and
   * OPENING) dated up to `toDay`: the same opening rule as the accounting reports.
   */
  async openingBalances(
    tenantId: string,
    fromDay: string,
    accountCode?: string,
    toDay: string = fromDay,
  ): Promise<Map<string, bigint>> {
    const rows: Array<{ code: string; balance: string }> = await this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT a.code AS code, COALESCE(SUM(l.debit - l.credit), 0) AS balance
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND e.status = 'POSTED'
            AND e.entry_type NOT IN ('CLOSING_PERM', 'OPENING_AUTO')
            AND (CAST(e.date AS date) < $2 OR ((e.entry_type = 'OPENING' OR (e.entry_type = 'NORMAL' AND e.entry_number LIKE 'OB-%')) AND CAST(e.date AS date) < $4))
            AND ($3::text IS NULL OR a.code = $3)
          GROUP BY a.code`,
        [tenantId, fromDay, accountCode ?? null, toDay],
      ),
    );
    return new Map(rows.map((r) => [r.code, fromDb(r.balance)]));
  }
}
