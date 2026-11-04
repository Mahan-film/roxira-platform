/**
 * SQL for the journal entry search (GET journal-entries with search filters). Pure: builds the
 * WHERE clause and its positional parameters, so the shape is unit-tested without a database.
 *
 * Every user value is a bound parameter. Text filters are ILIKE with `%`, `_` and `\` escaped,
 * so a search for "50%" matches the text "50%" and not every entry. Amounts stay decimal strings
 * and are compared as numeric in SQL; they never pass through a JS number.
 */

export interface JournalSearchFilter {
  status?: string;
  entryNumber?: string;
  /** YYYY-MM-DD, inclusive, on the entry's calendar day. */
  fromDate?: string;
  toDate?: string;
  /** Entries with at least one line on this account (exact code). */
  accountCode?: string;
  /** Entries with at least one line for this party (tafsili). */
  partyCode?: string;
  /** Entries with at least one line whose debit or credit is in [minAmount, maxAmount]. */
  minAmount?: string;
  maxAmount?: string;
  /** Text in the entry description or in any line description. */
  text?: string;
}

export interface JournalSearchSql {
  /** Conditions on `e` (fin_journal_entries), joined with AND; starts with the tenant. */
  where: string;
  params: unknown[];
}

/** Escapes LIKE wildcards; the clause uses the default `\` escape character. */
export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** True when the filter needs the search query (anything beyond status and entry number). */
export function needsSearch(filter: JournalSearchFilter): boolean {
  return Boolean(
    filter.fromDate ||
      filter.toDate ||
      filter.accountCode ||
      filter.partyCode ||
      filter.minAmount ||
      filter.maxAmount ||
      filter.text,
  );
}

export function journalSearchWhere(tenantId: string, filter: JournalSearchFilter): JournalSearchSql {
  const params: unknown[] = [tenantId];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const where: string[] = ['e.tenant_id = $1'];

  if (filter.status) where.push(`e.status = ${bind(filter.status)}`);
  if (filter.entryNumber) where.push(`e.entry_number ILIKE ${bind(likeContains(filter.entryNumber))}`);
  if (filter.fromDate) where.push(`CAST(e.date AS date) >= CAST(${bind(filter.fromDate)} AS date)`);
  if (filter.toDate) where.push(`CAST(e.date AS date) <= CAST(${bind(filter.toDate)} AS date)`);

  // One line must satisfy every line filter at once: "a 5,000,000 line on account 1103" means the
  // same line, not a 5,000,000 line somewhere and an 1103 line somewhere else.
  const line: string[] = [];
  if (filter.accountCode) {
    line.push(
      `EXISTS (SELECT 1 FROM fin_chart_of_accounts a WHERE a.id = l.account_id AND a.tenant_id = l.tenant_id AND a.code = ${bind(filter.accountCode)})`,
    );
  }
  if (filter.partyCode) line.push(`l.party_code = ${bind(filter.partyCode)}`);
  const amount = `GREATEST(l.debit, l.credit)`;
  if (filter.minAmount) line.push(`${amount} >= CAST(${bind(filter.minAmount)} AS numeric)`);
  if (filter.maxAmount) line.push(`${amount} <= CAST(${bind(filter.maxAmount)} AS numeric)`);
  if (line.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM fin_journal_entry_lines l WHERE l.journal_entry_id = e.id AND l.tenant_id = e.tenant_id AND ${line.join(' AND ')})`,
    );
  }

  if (filter.text) {
    const q = bind(likeContains(filter.text));
    where.push(
      `(e.description ILIKE ${q} OR EXISTS (SELECT 1 FROM fin_journal_entry_lines t WHERE t.journal_entry_id = e.id AND t.tenant_id = e.tenant_id AND t.description ILIKE ${q}))`,
    );
  }
  return { where: where.join(' AND '), params };
}
