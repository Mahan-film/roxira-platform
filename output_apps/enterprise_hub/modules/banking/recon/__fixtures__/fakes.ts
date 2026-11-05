import { ConflictException, HttpException } from '@nestjs/common';
import { ReconRepository, SettingsRow } from '../recon.repository';

/** In-memory ReconRepository that enforces the tenant predicate exactly like the SQL does. */
export class FakeReconRepository {
  private seq = 0;
  sessions: any[] = [];
  items: any[] = [];
  matches: any[] = [];
  rules: any[] = [];
  settings = new Map<string, SettingsRow>();
  drafts: any[] = [];
  attachments: any[] = [];
  reports: any[] = [];
  auditLog: any[] = [];
  legacyTaken = new Map<string, Set<number>>();

  private id() {
    return ++this.seq;
  }

  runInTransaction<T>(work: (m: any) => Promise<T>) {
    return work({});
  }

  async getSettings(t: string): Promise<SettingsRow> {
    return (
      this.settings.get(t) ?? {
        fee_max_rial: '5000000',
        sms_fee_max_rial: '500000',
        auto_post_fees: false,
        auto_match_min_confidence: '0.900',
        date_window_days: 3,
        category_accounts: {},
      }
    );
  }
  async saveSettings(t: string, _a: string, next: SettingsRow) {
    this.settings.set(t, next);
    return next;
  }
  async createSession(t: string, d: any) {
    const row = {
      id: this.id(), tenant_id: t, bank_account_id: d.bankAccountId, file_name: d.fileName, file_sha256: d.sha256,
      file_kind: d.kind, file_data: d.fileData, status: 'uploaded', layout_id: null, column_map: null, header_info: {},
      checks: [], confirmations: {}, period_from: null, period_to: null, opening_balance: null, closing_balance: null,
      created_by: d.createdBy, created_at: new Date(), committed_at: null,
    };
    this.sessions.push(row);
    return row;
  }
  async getSession(t: string, id: number) {
    const row = this.sessions.find((s) => s.tenant_id === t && s.id === id);
    return row ? { ...row, file_data: undefined } : null;
  }
  async getSessionFile(t: string, id: number) {
    return this.sessions.find((s) => s.tenant_id === t && s.id === id)?.file_data ?? null;
  }
  async updateSession(t: string, id: number, patch: any) {
    Object.assign(this.sessions.find((s) => s.tenant_id === t && s.id === id), patch);
  }
  async importedPeriods(t: string, accountId: number, exclude: number) {
    return this.sessions
      .filter((s) => s.tenant_id === t && s.bank_account_id === accountId && s.id !== exclude && s.status === 'committed')
      .map((s) => ({ id: s.id, file_sha256: s.file_sha256, period_from: s.period_from, period_to: s.period_to, opening_balance: s.opening_balance, closing_balance: s.closing_balance }));
  }
  async listSessions(t: string) {
    return this.sessions.filter((s) => s.tenant_id === t);
  }
  async insertItems(t: string, items: any[]) {
    const ids: number[] = [];
    for (const i of items) {
      if (this.items.some((x) => x.tenant_id === t && x.bank_account_id === i.bankAccountId && x.dedupe_key === i.dedupeKey)) continue;
      const row = {
        id: this.id(), tenant_id: t, session_id: i.sessionId, bank_account_id: i.bankAccountId, line_no: i.lineNo, txn_date: i.txnDate,
        txn_time: i.txnTime, description: i.description, withdrawal: i.withdrawal.toString(), deposit: i.deposit.toString(),
        balance: i.balance === null ? null : i.balance.toString(), reference: i.reference, cheque_no: i.chequeNo, sayad_id: i.sayadId,
        dedupe_key: i.dedupeKey, category: i.category, person_type: i.personType, counterparty: i.counterparty,
        classification_confidence: i.confidence.toFixed(3), classification_source: i.source, counter_account_code: i.counterAccountCode, status: 'open',
      };
      this.items.push(row);
      ids.push(row.id);
    }
    return ids;
  }
  async listItems(t: string, sessionId: number) {
    return this.items.filter((i) => i.tenant_id === t && i.session_id === sessionId);
  }
  async listItemsForAccount(t: string, accountId: number, toDate: string) {
    return this.items.filter((i) => i.tenant_id === t && i.bank_account_id === accountId && i.txn_date <= toDate);
  }
  async getItem(t: string, id: number) {
    return this.items.find((i) => i.tenant_id === t && i.id === id) ?? null;
  }
  async updateItem(t: string, id: number, patch: any) {
    Object.assign(this.items.find((i) => i.tenant_id === t && i.id === id), patch);
  }
  async insertMatch(t: string, d: any) {
    if (d.status === 'confirmed' && this.matches.some((m) => m.tenant_id === t && m.journal_line_id === d.journalLineId && m.status === 'confirmed')) {
      throw Object.assign(new Error('dup'), { code: '23505' });
    }
    this.matches.push({ id: this.id(), tenant_id: t, session_id: d.sessionId, group_id: d.groupId, item_id: d.itemId, journal_line_id: d.journalLineId, stage: d.stage, confidence: d.confidence.toFixed(3), status: d.status, method: d.method });
  }
  async listMatches(t: string, sessionId: number) {
    return this.matches.filter((m) => m.tenant_id === t && m.session_id === sessionId && m.status !== 'rejected');
  }
  async listMatchesForItems(t: string, ids: number[]) {
    return this.matches.filter((m) => m.tenant_id === t && ids.includes(m.item_id) && m.status === 'confirmed');
  }
  async setGroupStatus(t: string, sessionId: number, groupId: string, status: string) {
    let n = 0;
    for (const m of this.matches) {
      if (m.tenant_id === t && m.session_id === sessionId && m.group_id === groupId && m.status === 'suggested') {
        if (status === 'confirmed' && this.matches.some((o) => o.tenant_id === t && o.journal_line_id === m.journal_line_id && o.status === 'confirmed')) {
          throw Object.assign(new Error('dup'), { code: '23505' });
        }
        m.status = status;
        n += 1;
      }
    }
    return n;
  }
  async takenJournalLineIds(t: string) {
    return new Set<number>([
      ...this.matches.filter((m) => m.tenant_id === t && m.status === 'confirmed').map((m) => m.journal_line_id),
      ...(this.legacyTaken.get(t) ?? []),
    ]);
  }
  async releaseMatchesOfItem(t: string, itemId: number) {
    this.matches.filter((m) => m.tenant_id === t && m.item_id === itemId).forEach((m) => (m.status = 'rejected'));
  }
  async clearSuggested(t: string, sessionId: number) {
    this.matches.filter((m) => m.tenant_id === t && m.session_id === sessionId && m.status === 'suggested').forEach((m) => (m.status = 'rejected'));
  }
  async listRules(t: string) {
    return this.rules.filter((r) => r.tenant_id === t && r.active);
  }
  async upsertRule(t: string, _a: string, r: any) {
    const existing = this.rules.find((x) => x.tenant_id === t && x.kind === r.kind && x.pattern === r.pattern && x.active);
    if (existing) {
      Object.assign(existing, { category: r.category, person_type: r.personType, counter_account_code: r.counterAccountCode });
      return existing.id;
    }
    const row = { id: this.id(), tenant_id: t, kind: r.kind, pattern: r.pattern, category: r.category, person_type: r.personType, counter_account_code: r.counterAccountCode, hits: 0, active: true };
    this.rules.push(row);
    return row.id;
  }
  async deactivateRule(t: string, id: number) {
    const rule = this.rules.find((r) => r.tenant_id === t && r.id === id && r.active);
    if (rule) rule.active = false;
    return Boolean(rule);
  }
  async bumpRuleHits() {}
  async confirmedHistory(t: string) {
    return this.items.filter((i) => i.tenant_id === t && i.status === 'resolved' && i.counterparty && i.category).map((i) => ({ counterparty: i.counterparty, category: i.category }));
  }
  async insertDraft(t: string, d: any) {
    if (this.drafts.some((x) => x.tenant_id === t && x.item_id === d.itemId && ['draft', 'approved', 'posted'].includes(x.status))) return null;
    const row = {
      id: this.id(), tenant_id: t, session_id: d.sessionId, item_id: d.itemId, bank_account_id: d.bankAccountId, entry_date: d.entryDate,
      description: d.description, amount: d.amount.toString(), direction: d.direction, counter_account_code: d.counterAccountCode,
      category: d.category, status: 'draft', journal_entry_id: null, reversal_entry_id: null, auto: d.auto, failure_reason: null,
    };
    this.drafts.push(row);
    return { ...row };
  }
  async listDrafts(t: string, sessionId: number) {
    return this.drafts.filter((d) => d.tenant_id === t && d.session_id === sessionId).map((d) => ({ ...d }));
  }
  async getDraft(t: string, id: number) {
    const d = this.drafts.find((x) => x.tenant_id === t && x.id === id);
    return d ? { ...d } : null;
  }
  async updateDraft(t: string, id: number, patch: any) {
    Object.assign(this.drafts.find((x) => x.tenant_id === t && x.id === id), patch);
  }
  async claimDraft(t: string, id: number) {
    const d = this.drafts.find((x) => x.tenant_id === t && x.id === id && x.status === 'draft');
    if (!d) return false;
    d.status = 'approved';
    return true;
  }
  async insertAttachment(t: string, d: any) {
    this.attachments.push({ tenant_id: t, ...d });
    return this.attachments.length;
  }
  async insertReport(t: string, d: any) {
    const row = { id: this.id(), tenant_id: t, bank_account_id: d.bankAccountId, session_id: d.sessionId, period_from: d.periodFrom, period_to: d.periodTo, difference_minor: d.differenceMinor.toString(), snapshot: d.snapshot, created_by: d.createdBy, created_at: new Date() };
    this.reports.push(row);
    return row.id;
  }
  async listReports(t: string, accountId?: number) {
    return this.reports.filter((r) => r.tenant_id === t && (!accountId || r.bank_account_id === accountId));
  }
  async getReport(t: string, id: number) {
    return this.reports.find((r) => r.tenant_id === t && r.id === id) ?? null;
  }
  async audit(t: string, actor: string, action: string, subjectType: string, subjectId: any, details: any = {}) {
    this.auditLog.push({ tenant_id: t, actor, action, subjectType, subjectId, details });
  }
  async listAudit(t: string) {
    return this.auditLog.filter((a) => a.tenant_id === t);
  }
}

export interface FakeLedgerLine {
  id: number;
  journalEntryId: number;
  entryNumber: string;
  date: Date;
  description: string | null;
  entryDescription: string;
  debit: number;
  credit: number;
}

/** Fake of the two services the assistant depends on, with per-tenant data and period locks. */
export class FakeLedger {
  seq = 1000;
  lines = new Map<string, FakeLedgerLine[]>();
  lockedUntil = new Map<string, string>();
  entries: any[] = [];
  reversed = new Set<number>();
  bankAccounts = new Map<string, any[]>();
  codes = new Map<string, string[]>();

  addBank(tenant: string, account: any) {
    this.bankAccounts.set(tenant, [...(this.bankAccounts.get(tenant) ?? []), account]);
  }
  addLine(tenant: string, line: Partial<Omit<FakeLedgerLine, 'date'>> & { date: string; debit?: number; credit?: number }) {
    const row: FakeLedgerLine = {
      id: ++this.seq, journalEntryId: ++this.seq, entryNumber: `JV-${this.seq}`, description: null, entryDescription: '',
      debit: 0, credit: 0, ...line, date: new Date(`${line.date}T00:00:00Z`),
    } as FakeLedgerLine;
    this.lines.set(tenant, [...(this.lines.get(tenant) ?? []), row]);
    return row;
  }

  banking = {
    listAccounts: async (t: string) => this.bankAccounts.get(t) ?? [],
    createAccount: async (t: string, dto: any) => {
      const acc = { id: ++this.seq, name: dto.name, bankCode: dto.bankCode, accountNumber: dto.accountNumber, iban: dto.iban ?? null, ledgerAccountId: dto.ledgerAccountId, ledgerAccountCode: '1010', openingBalance: dto.openingBalance ?? 0 };
      this.addBank(t, acc);
      return acc;
    },
  };

  accounting = {
    findExistingAccountCodes: async (t: string, codes: string[]) => codes.filter((c) => (this.codes.get(t) ?? ['1010', '5090', '5010', '3030', '2020', '5020', '2030']).includes(c)),
    listAccounts: async (t: string) => {
      const codes = new Set([...(this.codes.get(t) ?? []), '1010', '5090', '5010', '3030', '2020', '5020', '2030']);
      return [...codes].map((code) => ({ code, name: `n${code}`, accountType: 'ASSET', level: 'moein' }));
    },
    listLedgerLines: async (t: string, _acc: number, opts: { toDate?: Date; lineIds?: number[] }) =>
      (this.lines.get(t) ?? []).filter((l) => (!opts.toDate || l.date <= opts.toDate) && (!opts.lineIds || opts.lineIds.includes(l.id))),
    createJournalEntry: async (t: string, dto: any) => {
      const locked = this.lockedUntil.get(t);
      if (locked && dto.date <= locked) {
        throw new HttpException({ statusCode: 423, message: 'date is inside a locked period' }, 423);
      }
      if (this.entries.some((e) => e.tenant === t && e.number === dto.entryNumber)) {
        throw new ConflictException('duplicate');
      }
      const id = ++this.seq;
      const bank = this.bankAccounts.get(t)?.[0];
      const bankCode = bank?.ledgerAccountCode;
      const lines = dto.lines.map((l: any) => ({ id: ++this.seq, accountCode: l.accountCode, accountId: bankCode && l.accountCode === bankCode ? bank.ledgerAccountId : 999 }));
      this.entries.push({ tenant: t, id, number: dto.entryNumber, dto, lines });
      const bankIndex = dto.lines.findIndex((l: any) => l.accountCode === bankCode);
      const index = bankIndex >= 0 ? bankIndex : 0;
      const first = dto.lines[index];
      this.addLine(t, { id: lines[index].id, journalEntryId: id, entryNumber: dto.entryNumber, date: dto.date, debit: Number(first.debit), credit: Number(first.credit) } as any);
      return { id, lines };
    },
    reverseJournalEntry: async (t: string, id: number) => {
      if (this.reversed.has(id)) throw new ConflictException('already reversed');
      const entry = this.entries.find((e) => e.tenant === t && e.id === id);
      if (!entry) throw new HttpException('not found', 404);
      this.reversed.add(id);
      return { id: ++this.seq };
    },
  };
}

/**
 * In-memory PostingRulesRepository: the real engine runs against it (unit specs), so the source
 * ledger, mappings and idempotency behave as in the database.
 */
export class FakePostingRulesRepository {
  private sources = new Map<string, { entryId: number | null; entryNumber: string | null; reversalEntryId: number | null }>();
  maps: Array<{ docType: string; role: string; accountCode: string }> = [];

  runInTransaction<T>(_tenantId: string, work: (manager: unknown) => Promise<T>): Promise<T> {
    return work({});
  }
  async listMappings(_tenantId: string, docTypes: string[]) {
    return this.maps.filter((m) => docTypes.includes(m.docType));
  }
  async findSource(_tenantId: string, sourceType: string, sourceId: string, docType: string) {
    return this.sources.get(`${sourceType}/${sourceId}/${docType}`) ?? null;
  }
  async claimSource(_tenantId: string, sourceType: string, sourceId: string, docType: string) {
    const key = `${sourceType}/${sourceId}/${docType}`;
    if (this.sources.has(key)) return false;
    this.sources.set(key, { entryId: null, entryNumber: null, reversalEntryId: null });
    return true;
  }
  async attachEntry(_tenantId: string, sourceType: string, sourceId: string, docType: string, entryId: number, entryNumber: string) {
    Object.assign(this.sources.get(`${sourceType}/${sourceId}/${docType}`)!, { entryId, entryNumber });
  }
  async attachReversal(_tenantId: string, sourceType: string, sourceId: string, docType: string, reversalEntryId: number) {
    Object.assign(this.sources.get(`${sourceType}/${sourceId}/${docType}`)!, { reversalEntryId });
  }
}
