import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../../accounting/money';
import { ElectronicBooksVoucherScope } from './electronic-books.constants';

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

export interface AccountTurnoverGroup {
  kolCode: string;
  kolName: string;
  moeinCode: string;
  moeinName: string;
  tafsiliCode: string;
  tafsiliName: string;
  date: Date;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface AccountTurnoverOptions {
  voucherScope?: ElectronicBooksVoucherScope;
  monthlyAggregate?: boolean;
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

interface RawTurnoverGroup {
  kolCode: string;
  kolName: string;
  moeinCode: string;
  moeinName: string;
  tafsiliCode: string | null;
  tafsiliName: string | null;
  date: Date;
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
   * Groups finalized posted voucher lines by kol + moein + tafsili + date for official electronic commercial books.
   * In Iranian COA coding, when `parent_code` is unpopulated on a Moein/Tafsili row, `SUBSTRING(a.code FROM 1 FOR 2)`
   * resolves the standard 2-digit Kol prefix as a deterministic fallback.
   */
  async accountTurnover(
    tenantId: string,
    fromDay: string,
    toDay: string,
    opts?: AccountTurnoverOptions,
  ): Promise<AccountTurnoverGroup[]> {
    const voucherScope = opts?.voucherScope ?? 'operational';
    const monthlyAggregate = Boolean(opts?.monthlyAggregate);
    const scopeClause =
      voucherScope === 'opening'
        ? `AND (e.entry_type IN ('OPENING', 'OPENING_AUTO') OR (e.entry_type = 'NORMAL' AND e.entry_number LIKE 'OB-%'))`
        : voucherScope === 'closing_temp'
          ? `AND e.entry_type = 'CLOSING_TEMP'`
          : voucherScope === 'closing_perm'
            ? `AND e.entry_type = 'CLOSING_PERM'`
            : `AND e.entry_type NOT IN ('CLOSING_PERM', 'CLOSING_TEMP', 'OPENING_AUTO') AND NOT (e.entry_type = 'OPENING' OR (e.entry_type = 'NORMAL' AND e.entry_number LIKE 'OB-%'))`;

    const tafsiliCodeExpr = monthlyAggregate
      ? `''`
      : `COALESCE(
             d.code,
             CASE WHEN l.party_code IS NOT NULL AND l.party_code != '' THEN l.party_code ELSE NULL END,
             CASE WHEN a.level = 'TAFSILI' THEN a.code ELSE '' END
           )`;
    const tafsiliNameExpr = monthlyAggregate
      ? `''`
      : `COALESCE(
             d.name,
             CASE WHEN l.party_code IS NOT NULL AND l.party_code != '' THEN l.party_code ELSE NULL END,
             CASE WHEN a.level = 'TAFSILI' THEN a.name ELSE '' END
           )`;
    const dimensionJoin = monthlyAggregate
      ? ''
      : `LEFT JOIN fin_dimensions d ON d.id = l.detail_id AND d.tenant_id = l.tenant_id AND d.kind = 'DETAIL'`;

    const rows: RawTurnoverGroup[] = await this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT 
           COALESCE(
             CASE 
               WHEN a.level = 'KOL' THEN a.code
               WHEN a.level = 'TAFSILI' THEN COALESCE(kol_indirect.code, moein_parent.parent_code, SUBSTRING(a.code FROM 1 FOR 2))
               ELSE COALESCE(kol_direct.code, a.parent_code, SUBSTRING(a.code FROM 1 FOR 2))
             END,
             SUBSTRING(a.code FROM 1 FOR 2)
           ) AS "kolCode",
           COALESCE(
             CASE 
               WHEN a.level = 'KOL' THEN a.name
               WHEN a.level = 'TAFSILI' THEN COALESCE(kol_indirect.name, moein_parent.name, a.name)
               ELSE COALESCE(kol_direct.name, a.name)
             END,
             a.name
           ) AS "kolName",
           COALESCE(
             CASE 
               WHEN a.level = 'KOL' THEN a.code
               WHEN a.level = 'TAFSILI' THEN COALESCE(moein_parent.code, a.parent_code, a.code)
               ELSE a.code
             END,
             a.code
           ) AS "moeinCode",
           COALESCE(
             CASE 
               WHEN a.level = 'KOL' THEN a.name
               WHEN a.level = 'TAFSILI' THEN COALESCE(moein_parent.name, a.name)
               ELSE a.name
             END,
             a.name
           ) AS "moeinName",
           ${tafsiliCodeExpr} AS "tafsiliCode",
           ${tafsiliNameExpr} AS "tafsiliName",
           CAST(e.date AS date) AS "date",
           SUM(l.debit) AS "debit",
           SUM(l.credit) AS "credit"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
         LEFT JOIN fin_chart_of_accounts kol_direct ON kol_direct.tenant_id = a.tenant_id 
           AND (kol_direct.code = a.parent_code OR (a.parent_code IS NULL AND kol_direct.code = SUBSTRING(a.code FROM 1 FOR 2) AND kol_direct.level = 'KOL'))
         LEFT JOIN fin_chart_of_accounts moein_parent ON moein_parent.tenant_id = a.tenant_id 
           AND moein_parent.code = a.parent_code
         LEFT JOIN fin_chart_of_accounts kol_indirect ON kol_indirect.tenant_id = a.tenant_id 
           AND (kol_indirect.code = moein_parent.parent_code OR (moein_parent.parent_code IS NULL AND kol_indirect.code = SUBSTRING(moein_parent.code FROM 1 FOR 2)))
         ${dimensionJoin}
         WHERE l.tenant_id = $1 
           AND e.status = 'POSTED'
           ${scopeClause}
           AND CAST(e.date AS date) >= $2 AND CAST(e.date AS date) < $3
         GROUP BY 1, 2, 3, 4, 5, 6, 7
         HAVING SUM(l.debit) > 0 OR SUM(l.credit) > 0
         ORDER BY 7, 1, 3, 5
         LIMIT ${LEDGER_EXPORT_MAX_ROWS + 1}`,
        [tenantId, fromDay, toDay],
      ),
    );
    if (rows.length > LEDGER_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `تعداد ردیف‌ها از ${LEDGER_EXPORT_MAX_ROWS} بیشتر است؛ دوره را محدودتر کنید.`,
      );
    }
    return rows.map((r) => ({
      kolCode: r.kolCode,
      kolName: r.kolName,
      moeinCode: r.moeinCode,
      moeinName: r.moeinName,
      tafsiliCode: r.tafsiliCode ?? '',
      tafsiliName: r.tafsiliName ?? '',
      date: new Date(r.date),
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
