import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { BankAccountEntity } from '../banking/entities/bank-account.entity';
import { BankStatementLineEntity } from '../banking/entities/bank-statement-line.entity';
import { BankingRepository } from '../banking/repositories/banking.repository';
import { BankingService } from '../banking/services/banking.service';
import { ChequeReconService } from './services/cheque-recon.service';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequesService } from './services/cheques.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

const currencyStub = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;

describePg('Cheque lifecycle on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let service: ChequesService;
  let accounting: AccountingService;
  let banking: BankingService;
  let recon: ChequeReconService;
  let seq = 0;

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => testDb.rawQuery<R>(sql, params);
  const sayad = () => String(1000000000000000 + ++seq);

  const base = (over: Record<string, unknown> = {}) => ({
    direction: ChequeDirection.RECEIVED,
    chequeNumber: `N${++seq}`,
    amount: '100',
    issueDate: '2026-10-01',
    dueDate: '2026-12-01',
    partyName: 'مشتری',
    partyCode: 'C-1',
    ...over,
  });

  /** Net balance (debit - credit) of an account code for a tenant, in rials. */
  const balance = async (tenantId: string, code: string): Promise<bigint> => {
    const rows = await q<{ b: string }>(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b
         FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE l.tenant_id = $1 AND a.code = $2`,
      [tenantId, code],
    );
    return BigInt(rows[0].b.split('.')[0]);
  };

  beforeAll(async () => {
    testDb = await createTestDatabase('chq');
    accounting = new AccountingService(new AccountingRepository(testDb.scope), currencyStub);
    const chequesRepo = new ChequesRepository(testDb.scope);
    banking = new BankingService(
      new BankingRepository(
        testDb.app.getRepository(BankAccountEntity),
        testDb.app.getRepository(BankStatementLineEntity),
        testDb.app,
      ),
      accounting,
    );
    service = new ChequesService(
      chequesRepo,
      accounting,
      new PostingRulesService(new PostingRulesRepository(testDb.scope), accounting),
      banking,
    );
    recon = new ChequeReconService(chequesRepo, banking);
    for (const tenantId of [T1, T2]) {
      await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)]).catch(() => undefined);
      // the tenant may already be seeded with the default chart: create only what is missing
      const have = new Set((await accounting.listAccounts(tenantId)).map((a) => a.code));
      for (const [code, name, type] of [
        ['1010', 'بانک', AccountType.ASSET],
        ['1020', 'حساب‌های دریافتنی', AccountType.ASSET],
        ['2010', 'حساب‌های پرداختنی', AccountType.LIABILITY],
      ] as const) {
        if (!have.has(code)) await accounting.createAccount(tenantId, { code, name, accountType: type } as never);
      }
    }
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('migration: the columns, the delivered status and FORCE RLS are in place', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'fin_cheques'`,
    );
    for (const c of ['sayad_registration_status', 'sayad_verified_by', 'sayad_verified_at', 'receiver_national_id', 'settled_amount', 'spent_to_code']) {
      expect(cols.map((r) => r.column_name)).toContain(c);
    }
    const rls = await q<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('fin_cheques','fin_cheque_events')`,
    );
    expect(rls.every((r) => r.relforcerowsecurity)).toBe(true);
  });

  it('received: register -> deposit -> clear nets notes accounts to zero and moves the money to the bank', async () => {
    const c = await service.create(T1, base({ sayadNumber: sayad() }) as never, 'u1');
    await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-11-25' });
    const done = await service.transition(T1, c.id, { status: ChequeStatus.CLEARED, eventDate: '2026-12-01' });
    expect(done.status).toBe('cleared');
    expect(done.events.map((e) => e.toStatus)).toEqual(['registered', 'deposited', 'cleared']);
    const dbEvents = await q<{ journal_entry_id: number; amount: string }>(
      `SELECT journal_entry_id, amount FROM fin_cheque_events WHERE cheque_id = $1 ORDER BY id`, [c.id]);
    expect(dbEvents.every((e) => e.journal_entry_id !== null && e.amount === '100.00')).toBe(true);
    expect(await balance(T1, '1110')).toBe(0n);
    expect(await balance(T1, '1120')).toBe(0n);
    expect(await balance(T1, '1010')).toBe(100n);
  });

  it('received: bounce restores the receivable; return afterwards posts nothing', async () => {
    const before = await balance(T1, '1020');
    const c = await service.create(T1, base() as never);
    await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED });
    await service.transition(T1, c.id, { status: ChequeStatus.BOUNCED });
    expect(await balance(T1, '1020')).toBe(before); // credited at creation, debited back at bounce
    const entries = await q<{ n: string }>(`SELECT count(*)::text AS n FROM fin_journal_entries WHERE tenant_id = $1`, [T1]);
    await service.transition(T1, c.id, { status: ChequeStatus.RETURNED });
    const after = await q<{ n: string }>(`SELECT count(*)::text AS n FROM fin_journal_entries WHERE tenant_id = $1`, [T1]);
    expect(after[0].n).toBe(entries[0].n);
  });

  it('received: endorsement posts the payable against the third party', async () => {
    const c = await service.create(T1, base() as never);
    await service.transition(T1, c.id, { status: ChequeStatus.SPENT, spentToName: 'تأمین‌کننده', spentToCode: 'S-1', spentToNationalId: '0499370899' });
    const row = await q<{ spent_to_code: string; spent_to_national_id: string; status: string }>(
      `SELECT spent_to_code, spent_to_national_id, status FROM fin_cheques WHERE id = $1`, [c.id]);
    expect(row[0]).toMatchObject({ spent_to_code: 'S-1', spent_to_national_id: '0499370899', status: 'spent' });
    const party = await q<{ party_code: string }>(
      `SELECT l.party_code FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE a.code = '2010' AND l.tenant_id = $1 AND l.party_code = 'S-1'`, [T1]);
    expect(party).toHaveLength(1);
  });

  it('issued: register -> deliver -> clear leaves the note payable at zero and the bank credited', async () => {
    const bank = await balance(T1, '1010');
    const c = await service.create(T1, base({ direction: ChequeDirection.ISSUED }) as never);
    expect(await balance(T1, '2110')).toBe(-100n);
    await service.transition(T1, c.id, { status: ChequeStatus.DELIVERED });
    await service.transition(T1, c.id, { status: ChequeStatus.CLEARED });
    expect(await balance(T1, '2110')).toBe(0n);
    expect(await balance(T1, '1010')).toBe(bank - 100n);
  });

  it('partial payment: part clears, the remainder bounces, the DB check keeps settled <= amount', async () => {
    const c = await service.create(T1, base({ amount: '1000' }) as never);
    await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED });
    const bank = await balance(T1, '1010');
    const part = await service.partialPayment(T1, c.id, { amount: '400' });
    expect(part).toMatchObject({ status: 'deposited', settledAmount: 400, remainingAmount: 600 });
    expect(await balance(T1, '1010')).toBe(bank + 400n);
    const receivable = await balance(T1, '1020');
    await service.transition(T1, c.id, { status: ChequeStatus.BOUNCED });
    expect(await balance(T1, '1020')).toBe(receivable + 600n);
    await expect(q(`UPDATE fin_cheques SET settled_amount = amount + 1 WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_fin_cheques_settled/);
  });

  it('partial payment: a client idempotency key makes a retry replay instead of settling twice', async () => {
    const c = await service.create(T1, base({ amount: '1000' }) as never);
    await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED });
    const bank = await balance(T1, '1010');
    const first = await service.partialPayment(T1, c.id, { amount: '300', idempotencyKey: 'pg-pay-1' });
    const retry = await service.partialPayment(T1, c.id, { amount: '300', idempotencyKey: 'pg-pay-1' });
    expect(first).toMatchObject({ status: 'deposited', settledAmount: 300, remainingAmount: 700 });
    expect(retry).toMatchObject({ status: 'deposited', settledAmount: 300, remainingAmount: 700 });
    expect(await balance(T1, '1010')).toBe(bank + 300n);
    const parts = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin_cheque_events WHERE cheque_id = $1 AND from_status = to_status`, [c.id]);
    expect(parts[0].n).toBe('1');
  });

  it('check constraints reject a verified cheque without a verifier, a bad national id and a bad status', async () => {
    const c = await service.create(T1, base() as never);
    await expect(q(`UPDATE fin_cheques SET sayad_verified = true WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_fin_cheques_verified_audit/);
    await expect(q(`UPDATE fin_cheques SET receiver_national_id = '123' WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_fin_cheques_national_ids/);
    await expect(q(`UPDATE fin_cheques SET status = 'weird' WHERE id = $1`, [c.id])).rejects.toThrow(/CHK_fin_cheques_status/);
  });

  it('Sayad: verification stores who and when; the Sayad id stays unique per tenant, reusable across tenants', async () => {
    const id = sayad();
    const c = await service.create(T1, base({ sayadNumber: id, receiverNationalId: '0499370899' }) as never);
    const v = await service.verifySayad(T1, c.id, 'user-42', { verified: true });
    expect(v).toMatchObject({ sayadVerified: true, sayadVerifiedBy: 'user-42', receiverNationalId: '0499370899' });
    await expect(service.create(T1, base({ sayadNumber: id }) as never)).rejects.toThrow(/صیاد/);
    await expect(service.create(T2, base({ sayadNumber: id }) as never)).resolves.toMatchObject({ status: 'registered' });
  });

  it('a failed posting (locked period) rolls the status and the event back', async () => {
    const c = await service.create(T1, base({ issueDate: '2026-01-01', dueDate: '2026-03-01' }) as never);
    await accounting.lockPeriod(T1, 'tester', { periodStart: '2026-02-01', periodEnd: '2026-02-28', reason: 'test' } as never);
    await expect(
      service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-02-10' }),
    ).rejects.toThrow();
    const after = await service.get(T1, c.id);
    expect(after.status).toBe('registered');
    expect(after.events).toHaveLength(1);
  });

  it("tenant isolation: T2 cannot see or move T1's cheques", async () => {
    const c = await service.create(T1, base() as never);
    await expect(service.get(T2, c.id)).rejects.toThrow(/یافت نشد/);
    await expect(service.transition(T2, c.id, { status: ChequeStatus.DEPOSITED })).rejects.toThrow(/یافت نشد/);
    await expect(service.partialPayment(T2, c.id, { amount: '1' })).rejects.toThrow(/یافت نشد/);
    expect((await service.list(T2, {})).every((r) => r.id !== c.id)).toBe(true);
  });

  describe('bank reconciliation and bounced report', () => {
    let bankAccountId: number;
    let otherBankAccountId: number;
    const stmt = (n: number, txnDate: string, deposit: number, withdrawal: number) => ({
      txnDate, description: `line ${n}`, withdrawal, deposit, balance: null, reference: `ref-${n}`, dedupeKey: `chq-${process.pid}-${n}`,
    });

    beforeAll(async () => {
      const ledger = async (code: string, name: string) =>
        (await accounting.listAccounts(T1)).find((a) => a.code === code) ??
        (await accounting.createAccount(T1, { code, name, accountType: AccountType.ASSET } as never));
      const bankLedger = await ledger('1010', 'بانک');
      const otherLedger = await ledger('1099', 'بانک دیگر');
      bankAccountId = (await banking.createAccount(T1, { name: 'جاری', accountNumber: `91${seq}001`, ledgerAccountId: bankLedger.id, openingBalance: 0 } as never)).id;
      otherBankAccountId = (await banking.createAccount(T1, { name: 'دیگر', accountNumber: `91${seq}002`, ledgerAccountId: otherLedger.id, openingBalance: 0 } as never)).id;
    });

    it('a cleared received cheque is suggested the matching deposit, confirmed, and then shows as reconciled', async () => {
      const c = await service.create(T1, base({ amount: '777000', issueDate: '2026-11-01', dueDate: '2026-11-10' }) as never);
      await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-11-05' });
      await service.transition(T1, c.id, { status: ChequeStatus.CLEARED, eventDate: '2026-11-10' });
      const [good, decoy, wrongDir] = await banking.importStatementLines(T1, bankAccountId, [
        stmt(1, '2026-11-11', 777000, 0), stmt(2, '2026-11-11', 777001, 0), stmt(3, '2026-11-11', 0, 777000),
      ]);
      const view = await recon.suggest(T1, { bankAccountId });
      const item = view.items.find((i) => i.chequeId === c.id)!;
      expect(item.state).toBe('suggested');
      expect(item.candidates.map((x) => x.statementLineId)).toEqual([good]);
      expect([decoy, wrongDir]).not.toContain(item.candidates[0].statementLineId);

      const done = await recon.match(T1, { bankAccountId, eventId: item.eventId, statementLineId: good });
      expect(done.state).toBe('reconciled');
      const line = (await banking.listStatementLines(T1, bankAccountId, {})).find((l) => l.id === good)!;
      expect(line.matchedJournalLineId).not.toBeNull();
      await expect(recon.match(T1, { bankAccountId, eventId: item.eventId, statementLineId: good })).rejects.toThrow();
    });

    it('an issued cheque matches a withdrawal; apply() handles single candidates', async () => {
      const c = await service.create(T1, base({ direction: ChequeDirection.ISSUED, amount: '555000', issueDate: '2026-11-01' }) as never);
      await service.transition(T1, c.id, { status: ChequeStatus.DELIVERED, eventDate: '2026-11-02' });
      await service.transition(T1, c.id, { status: ChequeStatus.CLEARED, eventDate: '2026-11-12' });
      const [w] = await banking.importStatementLines(T1, bankAccountId, [stmt(10, '2026-11-12', 0, 555000)]);
      const result = await recon.applyUnambiguous(T1, { bankAccountId });
      expect(result.matched).toBeGreaterThanOrEqual(1);
      const line = (await banking.listStatementLines(T1, bankAccountId, {})).find((l) => l.id === w)!;
      expect(line.matchedJournalLineId).not.toBeNull();
    });

    it('a partial payment is its own reconciliation item for its own amount', async () => {
      const c = await service.create(T1, base({ amount: '900000', issueDate: '2026-11-01' }) as never);
      await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-11-03' });
      await service.partialPayment(T1, c.id, { amount: '300000', eventDate: '2026-11-15' });
      await banking.importStatementLines(T1, bankAccountId, [stmt(20, '2026-11-15', 300000, 0)]);
      const items = (await recon.suggest(T1, { bankAccountId })).items.filter((i) => i.chequeId === c.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ state: 'suggested', amount: 300000 });
    });

    it('a bank account linked to another ledger account shows no_bank_line, and tenants are isolated', async () => {
      const items = (await recon.suggest(T1, { bankAccountId: otherBankAccountId })).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.state === 'no_bank_line')).toBe(true);
      expect((await recon.suggest(T2, { bankAccountId })).items).toEqual([]);
      const some = (await recon.suggest(T1, { bankAccountId })).items[0];
      await expect(recon.match(T2, { bankAccountId, eventId: some.eventId, statementLineId: 1 })).rejects.toThrow();
    });

    it('a clearing with bankAccountId posts to that account ledger and reconciles', async () => {
      const c = await service.create(T1, base({ amount: '888000', issueDate: '2026-11-01', dueDate: '2026-11-10' }) as never);
      await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-11-05' });
      await service.transition(T1, c.id, { status: ChequeStatus.CLEARED, eventDate: '2026-11-10', bankAccountId: otherBankAccountId });
      const [line] = await banking.importStatementLines(T1, otherBankAccountId, [stmt(30, '2026-11-10', 888000, 0)]);
      const view = await recon.suggest(T1, { bankAccountId: otherBankAccountId });
      const item = view.items.find((i) => i.chequeId === c.id)!;
      expect(item.state).toBe('suggested');
      expect(item.candidates.map((x) => x.statementLineId)).toEqual([line]);
      const done = await recon.match(T1, { bankAccountId: otherBankAccountId, eventId: item.eventId, statementLineId: line });
      expect(done.state).toBe('reconciled');
      const dbEvent = await q<{ bank_account_id: number }>(
        `SELECT bank_account_id FROM fin_cheque_events WHERE id = $1`, [item.eventId]);
      expect(dbEvent[0].bank_account_id).toBe(otherBankAccountId);
    });

    it('the bounced report ages cheques from their bounce date and reports the unpaid remainder', async () => {
      const c = await service.create(T1, base({ amount: '1000', issueDate: '2026-06-01', dueDate: '2026-06-10' }) as never);
      await service.transition(T1, c.id, { status: ChequeStatus.DEPOSITED, eventDate: '2026-06-11' });
      await service.partialPayment(T1, c.id, { amount: '400', eventDate: '2026-06-12' });
      await service.transition(T1, c.id, { status: ChequeStatus.BOUNCED, eventDate: '2026-06-15' });
      const r = await service.bouncedReport(T1, { asOf: '2026-11-01' });
      const row = r.items.find((i) => i.id === c.id)!;
      expect(row).toMatchObject({ bouncedOn: '2026-06-15', bucket: '90+', remainingAmount: 600 });
      expect((await service.bouncedReport(T2, { asOf: '2026-11-01' })).items).toEqual([]);
    });
  });
});
