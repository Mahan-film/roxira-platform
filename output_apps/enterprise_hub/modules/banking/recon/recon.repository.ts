import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';

/**
 * Persistence for the reconciliation assistant. Every statement carries `tenant_id` as its first
 * predicate; the tenant comes from the verified JWT only (callers pass it, never the client).
 * BIGINT columns come back from `pg` as strings and are exposed as strings here. DATE columns
 * come back as local-midnight Date objects and are turned into `YYYY-MM-DD` strings in `q()`,
 * which also unwraps the driver's result shape so every caller sees plain rows.
 */

const DATE_COLUMNS = ['period_from', 'period_to', 'txn_date', 'entry_date'];

const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function normaliseDates(rows: unknown[]): unknown[] {
  for (const value of rows) {
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      for (const column of DATE_COLUMNS) {
        if (row[column] instanceof Date) {
          row[column] = isoDate(row[column] as Date);
        }
      }
    }
  }
  return rows;
}

/** Column names of an update patch; values stay parameterised. Patches are built in code, this is the backstop. */
const patchEntries = (patch: object): Array<[string, unknown]> => {
  const entries = Object.entries(patch);
  for (const [column] of entries) {
    if (!/^[a-z][a-z_]*$/.test(column)) {
      throw new Error(`invalid column: ${column}`);
    }
  }
  return entries;
};

/** TypeORM's postgres driver answers UPDATE/DELETE with `[rows, affected]`, everything else with `rows`. */
const rowsOf = (result: unknown): unknown[] => {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0];
  }
  return Array.isArray(result) ? result : [];
};

export interface SessionRow {
  id: number;
  tenant_id: string;
  bank_account_id: number | null;
  file_name: string;
  file_sha256: string;
  file_kind: string;
  status: string;
  layout_id: string | null;
  column_map: Record<string, number> | null;
  header_info: Record<string, unknown>;
  checks: unknown[];
  confirmations: Record<string, string>;
  period_from: string | null;
  period_to: string | null;
  opening_balance: string | null;
  closing_balance: string | null;
  created_by: string;
  created_at: Date;
  committed_at: Date | null;
}

export interface ItemRow {
  id: number;
  tenant_id: string;
  session_id: number;
  bank_account_id: number;
  line_no: number;
  txn_date: string;
  txn_time: string | null;
  description: string;
  withdrawal: string;
  deposit: string;
  balance: string | null;
  reference: string | null;
  cheque_no: string | null;
  sayad_id: string | null;
  dedupe_key: string;
  category: string | null;
  person_type: string;
  counterparty: string | null;
  classification_confidence: string;
  classification_source: string;
  counter_account_code: string | null;
  status: string;
}

export interface NewItem {
  sessionId: number;
  bankAccountId: number;
  lineNo: number;
  txnDate: string;
  txnTime: string | null;
  description: string;
  withdrawal: bigint;
  deposit: bigint;
  balance: bigint | null;
  reference: string | null;
  chequeNo: string | null;
  sayadId: string | null;
  dedupeKey: string;
  category: string | null;
  personType: string;
  counterparty: string | null;
  confidence: number;
  source: string;
  counterAccountCode: string | null;
}

export interface MatchRow {
  id: number;
  session_id: number;
  group_id: string;
  item_id: number;
  journal_line_id: number;
  stage: string;
  confidence: string;
  status: string;
  method: string;
}

export interface RuleRow {
  id: number;
  kind: 'counterparty' | 'keyword';
  pattern: string;
  category: string;
  person_type: string | null;
  counter_account_code: string | null;
  hits: number;
}

export interface SettingsRow {
  fee_max_rial: string;
  sms_fee_max_rial: string;
  auto_post_fees: boolean;
  auto_match_min_confidence: string;
  date_window_days: number;
  category_accounts: Record<string, string>;
}

export interface DraftRow {
  id: number;
  session_id: number;
  item_id: number;
  bank_account_id: number;
  entry_date: string;
  description: string;
  amount: string;
  direction: 'in' | 'out';
  counter_account_code: string;
  category: string;
  status: string;
  journal_entry_id: number | null;
  reversal_entry_id: number | null;
  auto: boolean;
  failure_reason: string | null;
}

const DEFAULT_SETTINGS: SettingsRow = {
  fee_max_rial: '5000000',
  sms_fee_max_rial: '500000',
  auto_post_fees: false,
  auto_match_min_confidence: '0.900',
  date_window_days: 3,
  category_accounts: {},
};

@Injectable()
export class ReconRepository {
  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    if ((this.dataSource as { isInitialized?: boolean } | undefined)?.isInitialized) {
      return new TenantScope(this.dataSource);
    }
    return undefined;
  }

  runInTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    tenantId?: string,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (tenantId && scope) {
      return scope.run(tenantId, work);
    }
    return this.dataSource.transaction(work);
  }

  private q(manager?: EntityManager) {
    return (async (sql: string, params?: unknown[]) => {
      const scope = this.tenantScope;
      const tenantId = typeof params?.[0] === 'string' ? params[0] : undefined;
      const raw =
        scope && tenantId
          ? await scope.within(tenantId, manager, (m) => m.query(sql, params))
          : await (manager ?? this.dataSource).query(sql, params);
      return normaliseDates(rowsOf(raw));
    }) as (
      sql: string,
      params?: unknown[],
    ) => Promise<any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // ------------------------------------------------------------------ settings

  async getSettings(tenantId: string): Promise<SettingsRow> {
    const rows = await this.q()(
      `SELECT fee_max_rial, sms_fee_max_rial, auto_post_fees, auto_match_min_confidence, date_window_days, category_accounts
         FROM fin_bank_recon_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows[0] ?? { ...DEFAULT_SETTINGS };
  }

  async saveSettings(
    tenantId: string,
    actor: string,
    next: SettingsRow,
  ): Promise<SettingsRow> {
    await this.q()(
      `INSERT INTO fin_bank_recon_settings
         (tenant_id, fee_max_rial, sms_fee_max_rial, auto_post_fees, auto_match_min_confidence, date_window_days, category_accounts, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         fee_max_rial = EXCLUDED.fee_max_rial, sms_fee_max_rial = EXCLUDED.sms_fee_max_rial,
         auto_post_fees = EXCLUDED.auto_post_fees, auto_match_min_confidence = EXCLUDED.auto_match_min_confidence,
         date_window_days = EXCLUDED.date_window_days, category_accounts = EXCLUDED.category_accounts,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [
        tenantId,
        next.fee_max_rial,
        next.sms_fee_max_rial,
        next.auto_post_fees,
        next.auto_match_min_confidence,
        next.date_window_days,
        JSON.stringify(next.category_accounts),
        actor,
      ],
    );
    return this.getSettings(tenantId);
  }

  // ------------------------------------------------------------------ sessions

  async createSession(
    tenantId: string,
    data: {
      fileName: string;
      sha256: string;
      kind: string;
      fileData: Buffer;
      createdBy: string;
      bankAccountId: number | null;
    },
  ): Promise<SessionRow> {
    const rows = await this.q()(
      `INSERT INTO fin_bank_recon_sessions (tenant_id, bank_account_id, file_name, file_sha256, file_kind, file_data, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tenantId, data.bankAccountId, data.fileName.slice(0, 255), data.sha256, data.kind, data.fileData, data.createdBy],
    );
    return rows[0];
  }

  async getSession(tenantId: string, id: number): Promise<SessionRow | null> {
    const rows = await this.q()(
      `SELECT id, tenant_id, bank_account_id, file_name, file_sha256, file_kind, status, layout_id, column_map, header_info,
              checks, confirmations, period_from, period_to, opening_balance, closing_balance, created_by, created_at, committed_at
         FROM fin_bank_recon_sessions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async getSessionFile(tenantId: string, id: number): Promise<Buffer | null> {
    const rows = await this.q()(
      `SELECT file_data FROM fin_bank_recon_sessions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0]?.file_data ?? null;
  }

  async updateSession(
    tenantId: string,
    id: number,
    patch: Partial<{
      bank_account_id: number | null;
      status: string;
      layout_id: string | null;
      column_map: Record<string, number> | null;
      header_info: unknown;
      checks: unknown;
      confirmations: Record<string, string>;
      period_from: string | null;
      period_to: string | null;
      opening_balance: string | null;
      closing_balance: string | null;
      committed_at: Date | null;
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    const entries = patchEntries(patch);
    if (entries.length === 0) {
      return;
    }
    const json = new Set(['column_map', 'header_info', 'checks', 'confirmations']);
    const sets = entries.map(([key], index) => `${key} = $${index + 3}`);
    const values = entries.map(([key, value]) =>
      json.has(key) && value !== null ? JSON.stringify(value) : value,
    );
    await this.q(manager)(
      `UPDATE fin_bank_recon_sessions SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...values],
    );
  }

  /** Committed imports of one bank account, for overlap/continuity checks. */
  async importedPeriods(tenantId: string, bankAccountId: number, excludeSessionId: number) {
    const rows = await this.q()(
      `SELECT id, file_sha256, period_from, period_to, opening_balance, closing_balance
         FROM fin_bank_recon_sessions
        WHERE tenant_id = $1 AND bank_account_id = $2 AND id <> $3
          AND status IN ('committed','closed') AND period_from IS NOT NULL`,
      [tenantId, bankAccountId, excludeSessionId],
    );
    return rows as Array<{
      id: number;
      file_sha256: string;
      period_from: string;
      period_to: string;
      opening_balance: string | null;
      closing_balance: string | null;
    }>;
  }

  async listSessions(tenantId: string, bankAccountId?: number): Promise<SessionRow[]> {
    return this.q()(
      `SELECT id, tenant_id, bank_account_id, file_name, file_sha256, file_kind, status, layout_id, column_map, header_info,
              checks, confirmations, period_from, period_to, opening_balance, closing_balance, created_by, created_at, committed_at
         FROM fin_bank_recon_sessions
        WHERE tenant_id = $1 AND ($2::int IS NULL OR bank_account_id = $2)
        ORDER BY id DESC LIMIT 200`,
      [tenantId, bankAccountId ?? null],
    );
  }

  // --------------------------------------------------------------------- items

  /** Inserts items, skipping rows already imported for the account. Returns the inserted ids. */
  async insertItems(tenantId: string, items: NewItem[], manager: EntityManager): Promise<number[]> {
    const ids: number[] = [];
    for (const item of items) {
      const rows = await this.q(manager)(
        `INSERT INTO fin_bank_recon_items
           (tenant_id, session_id, bank_account_id, line_no, txn_date, txn_time, description, withdrawal, deposit, balance,
            reference, cheque_no, sayad_id, dedupe_key, category, person_type, counterparty,
            classification_confidence, classification_source, counter_account_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (tenant_id, bank_account_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [
          tenantId, item.sessionId, item.bankAccountId, item.lineNo, item.txnDate, item.txnTime, item.description,
          item.withdrawal.toString(), item.deposit.toString(), item.balance === null ? null : item.balance.toString(),
          item.reference, item.chequeNo, item.sayadId, item.dedupeKey, item.category, item.personType,
          item.counterparty, item.confidence.toFixed(3), item.source, item.counterAccountCode,
        ],
      );
      if (rows[0]) {
        ids.push(rows[0].id);
      }
    }
    return ids;
  }

  async listItems(tenantId: string, sessionId: number): Promise<ItemRow[]> {
    return this.q()(
      `SELECT * FROM fin_bank_recon_items WHERE tenant_id = $1 AND session_id = $2 ORDER BY txn_date, line_no, id`,
      [tenantId, sessionId],
    );
  }

  async listItemsForAccount(tenantId: string, bankAccountId: number, toDate: string): Promise<ItemRow[]> {
    return this.q()(
      `SELECT * FROM fin_bank_recon_items WHERE tenant_id = $1 AND bank_account_id = $2 AND txn_date <= $3 ORDER BY txn_date, id`,
      [tenantId, bankAccountId, toDate],
    );
  }

  async getItem(tenantId: string, id: number, manager?: EntityManager): Promise<ItemRow | null> {
    const rows = await this.q(manager)(
      `SELECT * FROM fin_bank_recon_items WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async updateItem(
    tenantId: string,
    id: number,
    patch: Partial<{
      category: string | null;
      person_type: string;
      counterparty: string | null;
      classification_confidence: string;
      classification_source: string;
      counter_account_code: string | null;
      status: string;
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    const entries = patchEntries(patch);
    if (entries.length === 0) {
      return;
    }
    await this.q(manager)(
      `UPDATE fin_bank_recon_items SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...entries.map(([, v]) => v)],
    );
  }

  // ------------------------------------------------------------------- matches

  async insertMatch(
    tenantId: string,
    data: { sessionId: number; groupId: string; itemId: number; journalLineId: number; stage: string; confidence: number; status: string; method: string; decidedBy: string | null },
    manager?: EntityManager,
  ): Promise<void> {
    await this.q(manager)(
      `INSERT INTO fin_bank_recon_matches (tenant_id, session_id, group_id, item_id, journal_line_id, stage, confidence, status, method, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $8::varchar = 'suggested' THEN NULL ELSE now() END)`,
      [tenantId, data.sessionId, data.groupId, data.itemId, data.journalLineId, data.stage, data.confidence.toFixed(3), data.status, data.method, data.decidedBy],
    );
  }

  async listMatches(tenantId: string, sessionId: number): Promise<MatchRow[]> {
    return this.q()(
      `SELECT id, session_id, group_id, item_id, journal_line_id, stage, confidence, status, method
         FROM fin_bank_recon_matches WHERE tenant_id = $1 AND session_id = $2 AND status <> 'rejected' ORDER BY id`,
      [tenantId, sessionId],
    );
  }

  async listMatchesForItems(tenantId: string, itemIds: number[]): Promise<MatchRow[]> {
    if (itemIds.length === 0) {
      return [];
    }
    return this.q()(
      `SELECT id, session_id, group_id, item_id, journal_line_id, stage, confidence, status, method
         FROM fin_bank_recon_matches WHERE tenant_id = $1 AND item_id = ANY($2::int[]) AND status = 'confirmed'`,
      [tenantId, itemIds],
    );
  }

  async setGroupStatus(
    tenantId: string,
    sessionId: number,
    groupId: string,
    status: 'confirmed' | 'rejected',
    actor: string,
    manager?: EntityManager,
  ): Promise<number> {
    const rows = await this.q(manager)(
      `UPDATE fin_bank_recon_matches SET status = $4, method = 'user', decided_by = $5, decided_at = now()
        WHERE tenant_id = $1 AND session_id = $2 AND group_id = $3 AND status = 'suggested' RETURNING id`,
      [tenantId, sessionId, groupId, status, actor],
    );
    return rows.length;
  }

  /** Journal lines already taken: confirmed reconciliation matches plus the legacy one-to-one flow. */
  async takenJournalLineIds(tenantId: string): Promise<Set<number>> {
    const rows = await this.q()(
      `SELECT journal_line_id AS id FROM fin_bank_recon_matches WHERE tenant_id = $1 AND status = 'confirmed'
       UNION
       SELECT matched_journal_line_id AS id FROM fin_bank_statement_lines WHERE tenant_id = $1 AND matched_journal_line_id IS NOT NULL`,
      [tenantId],
    );
    return new Set(rows.map((row) => Number(row.id)));
  }

  async releaseMatchesOfItem(tenantId: string, itemId: number, manager?: EntityManager): Promise<void> {
    await this.q(manager)(
      `UPDATE fin_bank_recon_matches SET status = 'rejected', decided_at = now() WHERE tenant_id = $1 AND item_id = $2 AND status <> 'rejected'`,
      [tenantId, itemId],
    );
  }

  // --------------------------------------------------------------------- rules

  async listRules(tenantId: string): Promise<RuleRow[]> {
    return this.q()(
      `SELECT id, kind, pattern, category, person_type, counter_account_code, hits FROM fin_bank_recon_rules
        WHERE tenant_id = $1 AND active ORDER BY id`,
      [tenantId],
    );
  }

  async upsertRule(
    tenantId: string,
    actor: string,
    rule: { kind: string; pattern: string; category: string; personType: string | null; counterAccountCode: string | null; sourceItemId: number },
    manager?: EntityManager,
  ): Promise<number> {
    const rows = await this.q(manager)(
      `INSERT INTO fin_bank_recon_rules (tenant_id, kind, pattern, category, person_type, counter_account_code, source_item_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, kind, pattern) WHERE active DO UPDATE SET
         category = EXCLUDED.category, person_type = EXCLUDED.person_type, counter_account_code = EXCLUDED.counter_account_code
       RETURNING id`,
      [tenantId, rule.kind, rule.pattern.slice(0, 80), rule.category, rule.personType, rule.counterAccountCode, rule.sourceItemId, actor],
    );
    return rows[0].id;
  }

  async deactivateRule(tenantId: string, id: number): Promise<boolean> {
    const rows = await this.q()(
      `UPDATE fin_bank_recon_rules SET active = false WHERE tenant_id = $1 AND id = $2 AND active RETURNING id`,
      [tenantId, id],
    );
    return rows.length > 0;
  }

  async bumpRuleHits(tenantId: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.q()(
      `UPDATE fin_bank_recon_rules SET hits = hits + 1 WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [tenantId, ids],
    );
  }

  /** Categories that people confirmed, per counterparty (the tenant's own history). */
  async confirmedHistory(tenantId: string) {
    const rows = await this.q()(
      `SELECT counterparty, category FROM fin_bank_recon_items
        WHERE tenant_id = $1 AND status = 'resolved' AND counterparty IS NOT NULL AND category IS NOT NULL
        LIMIT 20000`,
      [tenantId],
    );
    return rows as Array<{ counterparty: string; category: string }>;
  }

  async clearSuggested(tenantId: string, sessionId: number): Promise<void> {
    await this.q()(
      `UPDATE fin_bank_recon_matches SET status = 'rejected', decided_at = now()
        WHERE tenant_id = $1 AND session_id = $2 AND status = 'suggested'`,
      [tenantId, sessionId],
    );
  }

  /** Atomically takes a draft for posting; false when someone else already did. */
  async claimDraft(tenantId: string, id: number, actor: string): Promise<boolean> {
    const rows = await this.q()(
      `UPDATE fin_bank_recon_drafts SET status = 'approved', decided_by = $3, decided_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'draft' RETURNING id`,
      [tenantId, id, actor],
    );
    return rows.length === 1;
  }

  // -------------------------------------------------------------------- drafts

  async insertDraft(
    tenantId: string,
    draft: {
      sessionId: number; itemId: number; bankAccountId: number; entryDate: string; description: string;
      amount: bigint; direction: 'in' | 'out'; counterAccountCode: string; category: string; auto: boolean; createdBy: string;
    },
  ): Promise<DraftRow | null> {
    const rows = await this.q()(
      `INSERT INTO fin_bank_recon_drafts
         (tenant_id, session_id, item_id, bank_account_id, entry_date, description, amount, direction, counter_account_code, category, auto, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, item_id) WHERE status IN ('draft','approved','posted') DO NOTHING
       RETURNING *`,
      [tenantId, draft.sessionId, draft.itemId, draft.bankAccountId, draft.entryDate, draft.description.slice(0, 255),
        draft.amount.toString(), draft.direction, draft.counterAccountCode, draft.category, draft.auto, draft.createdBy],
    );
    return rows[0] ?? null;
  }

  async listDrafts(tenantId: string, sessionId: number): Promise<DraftRow[]> {
    return this.q()(
      `SELECT * FROM fin_bank_recon_drafts WHERE tenant_id = $1 AND session_id = $2 ORDER BY id`,
      [tenantId, sessionId],
    );
  }

  async getDraft(tenantId: string, id: number, manager?: EntityManager): Promise<DraftRow | null> {
    const rows = await this.q(manager)(
      `SELECT * FROM fin_bank_recon_drafts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async updateDraft(
    tenantId: string,
    id: number,
    patch: Partial<{ status: string; journal_entry_id: number | null; reversal_entry_id: number | null; failure_reason: string | null; decided_by: string; counter_account_code: string }>,
    manager?: EntityManager,
  ): Promise<void> {
    const entries = patchEntries(patch);
    if (entries.length === 0) {
      return;
    }
    await this.q(manager)(
      `UPDATE fin_bank_recon_drafts SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')}, decided_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...entries.map(([, v]) => v)],
    );
  }

  // --------------------------------------------------------------- attachments

  async insertAttachment(
    tenantId: string,
    data: { itemId: number; fileName: string; mime: string; size: number; sha256: string; data: Buffer; uploadedBy: string },
  ): Promise<number> {
    const rows = await this.q()(
      `INSERT INTO fin_bank_recon_attachments (tenant_id, item_id, file_name, mime, size_bytes, sha256, data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenantId, data.itemId, data.fileName.slice(0, 255), data.mime, data.size, data.sha256, data.data, data.uploadedBy],
    );
    return rows[0].id;
  }

  async listAttachments(tenantId: string, itemId: number) {
    return this.q()(
      `SELECT id, file_name, mime, size_bytes, sha256, created_at FROM fin_bank_recon_attachments
        WHERE tenant_id = $1 AND item_id = $2 ORDER BY id`,
      [tenantId, itemId],
    ) as Promise<Array<{ id: number; file_name: string; mime: string; size_bytes: number; sha256: string; created_at: Date }>>;
  }

  // ------------------------------------------------------------------- reports

  async insertReport(
    tenantId: string,
    data: { bankAccountId: number; sessionId: number | null; periodFrom: string; periodTo: string; differenceMinor: bigint; snapshot: unknown; createdBy: string },
  ): Promise<number> {
    const rows = await this.q()(
      `INSERT INTO fin_bank_recon_reports (tenant_id, bank_account_id, session_id, period_from, period_to, difference_minor, snapshot, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenantId, data.bankAccountId, data.sessionId, data.periodFrom, data.periodTo, data.differenceMinor.toString(), JSON.stringify(data.snapshot), data.createdBy],
    );
    return rows[0].id;
  }

  async listReports(tenantId: string, bankAccountId?: number) {
    return this.q()(
      `SELECT id, bank_account_id, session_id, period_from, period_to, difference_minor, created_by, created_at
         FROM fin_bank_recon_reports WHERE tenant_id = $1 AND ($2::int IS NULL OR bank_account_id = $2)
        ORDER BY period_to DESC, id DESC LIMIT 200`,
      [tenantId, bankAccountId ?? null],
    ) as Promise<Array<{ id: number; bank_account_id: number; session_id: number | null; period_from: string; period_to: string; difference_minor: string; created_by: string; created_at: Date }>>;
  }

  async getReport(tenantId: string, id: number) {
    const rows = await this.q()(
      `SELECT id, bank_account_id, snapshot FROM fin_bank_recon_reports WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return (rows[0] ?? null) as { id: number; bank_account_id: number; snapshot: any } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // --------------------------------------------------------------------- audit

  async audit(
    tenantId: string,
    actor: string,
    action: string,
    subjectType: string,
    subjectId: string | number | null,
    details: Record<string, unknown> = {},
    manager?: EntityManager,
  ): Promise<void> {
    await this.q(manager)(
      `INSERT INTO fin_bank_recon_audit (tenant_id, actor, action, subject_type, subject_id, details) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, actor.slice(0, 64), action, subjectType, subjectId === null ? null : String(subjectId), JSON.stringify(details)],
    );
  }

  async listAudit(tenantId: string, subjectType?: string, subjectId?: string) {
    return this.q()(
      `SELECT id, actor, action, subject_type, subject_id, details, created_at FROM fin_bank_recon_audit
        WHERE tenant_id = $1 AND ($2::text IS NULL OR subject_type = $2) AND ($3::text IS NULL OR subject_id = $3)
        ORDER BY id DESC LIMIT 500`,
      [tenantId, subjectType ?? null, subjectId ?? null],
    );
  }
}
