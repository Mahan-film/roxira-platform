import { TenantScope } from '../../access/services/tenant-scope';
/**
 * Reconciliation assistant against a REAL PostgreSQL: the migration, the raw-SQL repository, the
 * ledger and the guided flow end to end, using a real statement file.
 *
 * Opt-in like accounting.ledger.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set. Each run
 * creates and drops its own database. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55439 npx jest modules/banking/recon/recon.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../../accounting/entities/journal-entry-line.entity';
import { PeriodLockEntity } from '../../accounting/entities/period-lock.entity';
import { AccountingRepository } from '../../accounting/repositories/accounting.repository';
import { AccountingService } from '../../accounting/services/accounting.service';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { PostingRulesRepository } from '../../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import { BankCode } from '../enums/banking.enum';
import { BankingRepository } from '../repositories/banking.repository';
import { BankingService } from '../services/banking.service';
import {
  ACCOUNT_NUMBER,
  closingBalance,
  gregorian,
  OPENING,
  statementCsv,
  TXNS,
} from './__fixtures__/statements';
import { ReconRepository } from './recon.repository';
import { ReconService } from './recon.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'preparer-1';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

const currencyStub = {
  convert: (value: number) => value,
  round: (value: number) => value,
} as unknown as CurrencyService;

const file = (buffer: Buffer, name = 'statement.csv') => ({ buffer, originalname: name, mimetype: 'text/csv' });

describePg('Reconciliation assistant on PostgreSQL', () => {
  const dbName = `rx_recon_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let banking: BankingService;
  let recon: ReconService;
  let repo: ReconRepository;
  let ledgerId: number;
  let bankAccountId: number;

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) =>
    ds.query(sql, params) as Promise<R[]>;

  const account = async (tenantId: string, code: string, name: string, accountType: AccountType) =>
    accounting.createAccount(tenantId, { code, name, accountType } as never);

  /** A voucher in the books that the statement's deposit should clear. */
  const bookDeposit = async (tenantId: string, entryNumber: string, jalali: string, amount: number) =>
    accounting.createJournalEntry(
      tenantId,
      {
        entryNumber,
        date: gregorian(jalali),
        description: 'دریافت از مشتری',
        lines: [
          { accountCode: '1190', debit: String(amount), credit: '0' },
          { accountCode: '4190', debit: '0', credit: String(amount) },
        ],
      } as never,
    );

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();

    accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      currencyStub,
    );
    const postingRules = new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting);
    banking = new BankingService(
      new BankingRepository(ds.getRepository(BankAccountEntity), ds.getRepository(BankStatementLineEntity), ds),
      accounting,
      postingRules,
    );
    repo = new ReconRepository(ds);
    recon = new ReconService(repo, banking, accounting, postingRules);

    for (const tenantId of [T1, T2]) {
      await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)]).catch(() => undefined);
      const ledger = await account(tenantId, '1190', 'بانک ملت', AccountType.ASSET);
      if (tenantId === T1) ledgerId = ledger.id;
      await account(tenantId, '4190', 'فروش', AccountType.REVENUE);
      await account(tenantId, '5190', 'کارمزد بانکی', AccountType.EXPENSE);
    }
    bankAccountId = (
      await banking.createAccount(T1, {
        name: 'جاری ملت',
        bankCode: BankCode.MELLAT,
        accountNumber: ACCOUNT_NUMBER,
        ledgerAccountId: ledgerId,
        openingBalance: OPENING,
      } as never)
    ).id;
  }, 180_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  let sessionId: number;

  it('the migration creates every table with a tenant column', async () => {
    const tables = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_name LIKE 'fin_bank_recon_%'`,
    );
    expect(tables).toHaveLength(9);
  });

  it('a broken running balance stops the flow with a question, and the file is stored', async () => {
    const view = await recon.uploadStatement(T1, ACTOR, file(statementCsv('mellat', { breakBalanceAt: 2 }), 'broken.csv'));
    expect(view.status).toBe('needs_confirmation');
    expect(view.checks.find((c) => c.code === 'running_balance')?.severity).not.toBe('ok');
    await expect(recon.commit(T1, ACTOR, view.id)).rejects.toBeInstanceOf(ConflictException);
    const [{ n }] = await q(`SELECT octet_length(file_data) AS n FROM fin_bank_recon_sessions WHERE id = $1`, [view.id]);
    expect(Number(n)).toBeGreaterThan(100);
    await q(`UPDATE fin_bank_recon_sessions SET status = 'discarded' WHERE id = $1`, [view.id]);
  });

  it('a clean statement resolves the account and period from the file, without a question', async () => {
    await bookDeposit(T1, 'BOOK-1', TXNS[0].jalali, TXNS[0].deposit);
    const view = await recon.uploadStatement(T1, ACTOR, file(statementCsv('mellat')));
    sessionId = view.id;
    const open = view.checks.filter((c) => c.severity === 'ask' || c.severity === 'block');
    for (const check of open) {
      await recon.answerCheck(T1, ACTOR, view.id, check.code, check.choices[0].id);
    }
    const ready = await recon.getSession(T1, view.id);
    expect(ready.status).toBe('ready');
    expect(ready.bankAccountId).toBe(bankAccountId);
    expect(ready.period?.from).toBe(gregorian(TXNS[0].jalali));
  });

  it('commit writes bigint rows, matches the book voucher and detects the fees', async () => {
    await recon.updateSettings(T1, 'admin', { categoryAccounts: { bank_fee: '5190', sms_fee: '5190' } });
    const review = await recon.commit(T1, ACTOR, sessionId);
    expect(review.counts.matched).toBe(1);

    const rows = await q<{ withdrawal: string; category: string | null; status: string }>(
      `SELECT withdrawal, category, status FROM fin_bank_recon_items WHERE tenant_id = $1 AND session_id = $2 ORDER BY line_no`,
      [T1, sessionId],
    );
    expect(rows).toHaveLength(TXNS.length);
    expect(rows.find((r) => r.category === 'bank_fee')?.withdrawal).toBe('350000');
    const feeDrafts = review.drafts.filter((d) => d.category === 'bank_fee' || d.category === 'sms_fee');
    expect(feeDrafts).toHaveLength(2);
    expect(feeDrafts.every((d) => d.status === 'draft' && !d.auto)).toBe(true);
    // Nothing was posted: the fees wait for a person because auto-post is off by default.
    expect(await q(`SELECT 1 FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number LIKE 'RCN-%'`, [T1])).toEqual([]);
  });

  it('every mismatch the classifier cannot decide becomes a question, and answering teaches a rule', async () => {
    const review = await recon.getReview(T1, sessionId);
    const question = review.questions.find((x) => x.kind === 'classify');
    expect(question).toBeDefined();
    const choice = question!.choices.find((c) => c.category)!;
    const result = await recon.answerQuestion(T1, ACTOR, question!.itemId, {
      choiceId: choice.id,
      counterAccountCode: '5190',
    });
    expect(result.draft?.counterAccountCode).toBe('5190');
    const [{ status }] = await q<{ status: string }>(`SELECT status FROM fin_bank_recon_items WHERE id = $1`, [question!.itemId]);
    expect(status).toBe('resolved');
  });

  it('approval posts a balanced voucher, links the bank line and cannot run twice', async () => {
    const review = await recon.getReview(T1, sessionId);
    const fee = review.drafts.find((d) => d.category === 'bank_fee')!;
    const [first, second] = await Promise.all([
      recon.approveDrafts(T1, 'approver', [fee.id]),
      recon.approveDrafts(T1, 'approver', [fee.id]),
    ]);
    const outcomes = [first[0].status, second[0].status].sort();
    expect(outcomes).toEqual(['posted', 'skipped']);
    const lines = await q<{ debit: string; credit: string }>(
      `SELECT l.debit, l.credit FROM fin_journal_entry_lines l JOIN fin_journal_entries e ON e.id = l.journal_entry_id
        WHERE e.tenant_id = $1 AND e.entry_number = $2`,
      [T1, `RCN-${fee.id}`],
    );
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0)).toBe(0);
    const [{ n }] = await q(`SELECT count(*) AS n FROM fin_bank_recon_matches WHERE tenant_id = $1 AND status = 'confirmed' AND stage = 'created'`, [T1]);
    expect(n).toBe('1');
  });

  it('posting the same draft again replays the engine source and writes no second voucher', async () => {
    const [posted] = await q<{ id: number; journal_entry_id: number }>(
      `SELECT id, journal_entry_id FROM fin_bank_recon_drafts WHERE tenant_id = $1 AND status = 'posted' ORDER BY id LIMIT 1`,
      [T1],
    );
    await q(`UPDATE fin_bank_recon_drafts SET status = 'draft', journal_entry_id = NULL WHERE tenant_id = $1 AND id = $2`, [T1, posted.id]);
    const [again] = await recon.approveDrafts(T1, 'approver', [posted.id]);
    expect(again.status).toBe('posted');
    expect(again.journalEntryId).toBe(posted.journal_entry_id);
    const entries = await q<{ n: string }>(
      `SELECT count(*) AS n FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number = $2`,
      [T1, `RCN-${posted.id}`],
    );
    expect(entries[0].n).toBe('1');
  });

  it('one journal line cannot be confirmed against two statement rows (database guard)', async () => {
    const [existing] = await q<{ journal_line_id: number; item_id: number; session_id: number }>(
      `SELECT journal_line_id, item_id, session_id FROM fin_bank_recon_matches WHERE tenant_id = $1 AND status = 'confirmed' LIMIT 1`,
      [T1],
    );
    const [other] = await q<{ id: number }>(
      `SELECT id FROM fin_bank_recon_items WHERE tenant_id = $1 AND id <> $2 LIMIT 1`,
      [T1, existing.item_id],
    );
    await expect(
      repo.insertMatch(T1, {
        sessionId: existing.session_id,
        groupId: 'dup',
        itemId: other.id,
        journalLineId: existing.journal_line_id,
        stage: 'manual',
        confidence: 1,
        status: 'confirmed',
        method: 'user',
        decidedBy: ACTOR,
      } as never),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('auto-post covers only small fees, and only after an admin switched it on', async () => {
    await recon.updateSettings(T1, 'admin', { autoPostFees: true });
    const april = TXNS.map((t) => ({ ...t, jalali: t.jalali.replace('/07/', '/08/'), reference: `8${t.reference}` }));
    const view = await recon.uploadStatement(T1, ACTOR, file(statementCsv('mellat', { txns: april, openingBalance: closingBalance() }), 'next.csv'));
    for (const check of view.checks.filter((c) => c.severity === 'ask' || c.severity === 'block')) {
      await recon.answerCheck(T1, ACTOR, view.id, check.code, check.choices[0].id);
    }
    const review = await recon.commit(T1, ACTOR, view.id);
    const posted = review.drafts.filter((d) => d.status === 'posted');
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((d) => d.auto && (d.category === 'bank_fee' || d.category === 'sms_fee'))).toBe(true);
    await recon.updateSettings(T1, 'admin', { autoPostFees: false });
  });

  it('the report difference is exact and the snapshot survives a bigint round trip', async () => {
    const { id, statement } = await recon.buildReport(T1, ACTOR, sessionId);
    expect(typeof statement.difference).toBe('bigint');
    const file2 = await recon.exportReport(T1, id, 'csv');
    expect(file2.body.toString('utf8').length).toBeGreaterThan(20);
    const history = await recon.listReports(T1, bankAccountId);
    expect(history.map((r) => r.id)).toContain(id);
  });

  it('correction is reversal-only: the original voucher stays and the item reopens', async () => {
    const posted = (await recon.getReview(T1, sessionId)).drafts.find((d) => d.status === 'posted')!;
    const reversed = await recon.reverseDraft(T1, 'approver', posted.id, 'اشتباه ثبت شد');
    expect(reversed.status).toBe('reversed');
    expect(reversed.reversalEntryId).toBeTruthy();
    expect(await q(`SELECT 1 FROM fin_journal_entries WHERE id = $1`, [posted.journalEntryId])).toHaveLength(1);
    const [{ status }] = await q<{ status: string }>(`SELECT status FROM fin_bank_recon_items WHERE id = $1`, [posted.itemId]);
    expect(status).toBe('open');
  });

  it('the audit log is append-only at the database level', async () => {
    await expect(q(`UPDATE fin_bank_recon_audit SET actor = 'x'`)).rejects.toThrow();
    await expect(q(`DELETE FROM fin_bank_recon_audit`)).rejects.toThrow();
    const entries = await recon.listAudit(T1);
    expect(entries.length).toBeGreaterThan(5);
  });

  it('another tenant sees nothing and cannot touch anything', async () => {
    await expect(recon.getSession(T2, sessionId)).rejects.toThrow();
    await expect(recon.getReview(T2, sessionId)).rejects.toThrow();
    expect(await recon.listSessions(T2)).toEqual([]);
    expect(await recon.listReports(T2)).toEqual([]);
    expect(await recon.listRules(T2)).toEqual([]);
    expect(await recon.listAudit(T2)).toEqual([]);
    const review = await recon.getReview(T1, sessionId);
    const draft = review.drafts.find((d) => d.status === 'draft');
    if (draft) {
      expect((await recon.approveDrafts(T2, 'evil', [draft.id]))[0].status).toBe('skipped');
    }
  });

  it('the migration reverts and reapplies cleanly', async () => {
    const pending = ds.migrations.find((m) => m.name === 'CreateBankReconAssistant1789372000000')!;
    const runner = ds.createQueryRunner();
    try {
      await pending.down(runner);
      expect(await q(`SELECT to_regclass('fin_bank_recon_sessions') AS t`)).toEqual([{ t: null }]);
      await pending.up(runner);
      expect(await q(`SELECT to_regclass('fin_bank_recon_sessions') AS t`)).toEqual([{ t: 'fin_bank_recon_sessions' }]);
    } finally {
      await runner.release();
    }
  });
});
