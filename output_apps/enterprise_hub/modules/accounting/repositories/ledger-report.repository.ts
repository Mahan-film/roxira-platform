import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/** Entry kind as reports see it: imported `OB-` entries are openings. */
const KIND = `CASE WHEN e.entry_type = 'NORMAL' AND e.entry_number LIKE 'OB-%' THEN 'OPENING' ELSE e.entry_type END`;
const DAY = `CAST(e.date AS date)`;
/** The closing and opening pair of a fiscal close cancel out; balances carry across years without them. */
const NOT_PAIR = `e.entry_type NOT IN ('CLOSING_PERM', 'OPENING_AUTO')`;

/** Exact numeric strings per account, split by reporting bucket. */
export interface AccountBucketRow {
  accountId: number;
  code: string;
  partyCode?: string | null;
  openingDebit: string;
  openingCredit: string;
  priorDebit: string;
  priorCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface LedgerLineRow {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: Date;
  accountCode: string;
  accountName: string;
  partyCode: string | null;
  description: string;
  debit: string;
  credit: string;
}

export interface LedgerFilter {
  accountIds: number[];
  partyCode?: string;
  from: string;
  to: string;
  limit: number;
}

/** Read-only report queries over POSTED lines. Sums stay PostgreSQL numeric (exact strings). */
@Injectable()
export class LedgerReportRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Per-account buckets for a period inside a year starting at `yearStart`:
   *  - opening: everything before `yearStart`, plus openings dated up to `to`;
   *  - prior: normal entries from `yearStart` to the day before `from`;
   *  - period: normal entries in `from`..`to`;
   *  - closing: CLOSING_TEMP entries in `yearStart`..`to`.
   * Bucket boundaries are enforced here, once, so every report adds up the same way.
   */
  async accountBuckets(
    tenantId: string,
    range: { yearStart: string; from: string; to: string; byParty?: boolean },
    manager?: EntityManager,
  ): Promise<AccountBucketRow[]> {
    const party = range.byParty ? `, l.party_code` : '';
    const sum = (column: string, condition: string): string =>
      `COALESCE(SUM(l.${column}) FILTER (WHERE ${condition}), 0)`;
    const opening = `${DAY} < $2 OR (${KIND} = 'OPENING' AND ${DAY} <= $4)`;
    const prior = `${KIND} = 'NORMAL' AND ${DAY} >= $2 AND ${DAY} < $3`;
    const period = `${KIND} = 'NORMAL' AND ${DAY} >= $3 AND ${DAY} <= $4`;
    const closing = `e.entry_type = 'CLOSING_TEMP' AND ${DAY} >= $2 AND ${DAY} <= $4`;
    const rows: AccountBucketRow[] = await (manager ?? this.dataSource).query(
      `SELECT a.id AS "accountId", a.code AS "code"${party ? `, l.party_code AS "partyCode"` : ''},
              ${sum('debit', opening)} AS "openingDebit", ${sum('credit', opening)} AS "openingCredit",
              ${sum('debit', prior)} AS "priorDebit", ${sum('credit', prior)} AS "priorCredit",
              ${sum('debit', period)} AS "periodDebit", ${sum('credit', period)} AS "periodCredit",
              ${sum('debit', closing)} AS "closingDebit", ${sum('credit', closing)} AS "closingCredit"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND e.status = 'POSTED' AND ${NOT_PAIR}
        GROUP BY a.id, a.code${party}
        ORDER BY a.code${party}`,
      [tenantId, range.yearStart, range.from, range.to],
    );
    return rows;
  }

  /** Debit-positive balance of every account up to `to`, without the closing and opening pair. */
  async balancesUpTo(
    tenantId: string,
    to: string,
    manager: EntityManager,
  ): Promise<Array<{ accountId: number; code: string; balance: string }>> {
    return manager.query(
      `SELECT a.id AS "accountId", a.code AS "code", SUM(l.debit - l.credit) AS "balance"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND e.status = 'POSTED' AND ${NOT_PAIR} AND ${DAY} <= $2
        GROUP BY a.id, a.code
        ORDER BY a.code`,
      [tenantId, to],
    );
  }

  /** Earliest day with a posted line, to anchor reports of a company without fiscal years. */
  async firstEntryDay(tenantId: string): Promise<string | null> {
    const rows: Array<{ day: string | null }> = await this.dataSource.query(
      `SELECT to_char(MIN(e.date), 'YYYY-MM-DD') AS "day"
         FROM fin_journal_entries e WHERE e.tenant_id = $1 AND e.status = 'POSTED'`,
      [tenantId],
    );
    return rows[0]?.day ?? null;
  }

  /** Entries of a fiscal close (by number prefix), newest last, not yet reversed. */
  async findCloseEntryIds(
    tenantId: string,
    prefixes: string[],
    manager: EntityManager,
  ): Promise<Array<{ id: number; date: string }>> {
    return manager.query(
      `SELECT e.id AS "id", to_char(e.date, 'YYYY-MM-DD') AS "date"
         FROM fin_journal_entries e
        WHERE e.tenant_id = $1 AND e.entry_number = ANY($2)
          AND NOT EXISTS (
            SELECT 1 FROM fin_journal_entries r
             WHERE r.tenant_id = e.tenant_id AND r.reverses_entry_id = e.id)
        ORDER BY e.id DESC`,
      [tenantId, prefixes],
    );
  }

  /**
   * Opening, debit and credit totals for the account set in the period, ignoring the row limit.
   * Opening entries count as opening balance here too, so a ledger agrees with the trial balance.
   */
  async ledgerTotals(
    tenantId: string,
    filter: LedgerFilter,
  ): Promise<{ opening: string; debit: string; credit: string; count: string }> {
    const party = filter.partyCode ? `AND l.party_code = $5` : '';
    const rows = await this.dataSource.query(
      `SELECT COALESCE(SUM(l.debit - l.credit) FILTER (WHERE ${DAY} < $3 OR ${KIND} = 'OPENING'), 0) AS "opening",
              COALESCE(SUM(l.debit) FILTER (WHERE ${DAY} >= $3 AND ${KIND} <> 'OPENING'), 0) AS "debit",
              COALESCE(SUM(l.credit) FILTER (WHERE ${DAY} >= $3 AND ${KIND} <> 'OPENING'), 0) AS "credit",
              COUNT(*) FILTER (WHERE ${DAY} >= $3 AND ${KIND} <> 'OPENING') AS "count"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.account_id = ANY($2) AND e.status = 'POSTED' AND ${NOT_PAIR}
          AND ${DAY} <= $4 ${party}`,
      [tenantId, filter.accountIds, filter.from, filter.to, ...(filter.partyCode ? [filter.partyCode] : [])],
    );
    return rows[0];
  }

  async ledgerLines(tenantId: string, filter: LedgerFilter): Promise<LedgerLineRow[]> {
    const party = filter.partyCode ? `AND l.party_code = $6` : '';
    return this.dataSource.query(
      `SELECT l.id AS "id", l.journal_entry_id AS "journalEntryId", e.entry_number AS "entryNumber",
              e.date AS "date", a.code AS "accountCode", a.name AS "accountName",
              l.party_code AS "partyCode", COALESCE(l.description, e.description) AS "description",
              l.debit AS "debit", l.credit AS "credit"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.account_id = ANY($2) AND e.status = 'POSTED' AND ${NOT_PAIR}
          AND ${DAY} >= $3 AND ${DAY} <= $4 AND ${KIND} <> 'OPENING' ${party}
        ORDER BY e.date ASC, l.id ASC
        LIMIT $5`,
      [tenantId, filter.accountIds, filter.from, filter.to, filter.limit, ...(filter.partyCode ? [filter.partyCode] : [])],
    );
  }
}
