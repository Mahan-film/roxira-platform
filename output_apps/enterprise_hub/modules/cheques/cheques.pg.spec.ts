import { TenantScope } from '../access/services/tenant-scope';
/**
 * Cheque lifecycle on a REAL PostgreSQL: migrations (including the Sayad / partial-payment one), FORCE RLS tables,
 * the TenantScope repository, and real balanced journal entries through AccountingService.
 *
 * Opt-in like accounting.ledger.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and drops its
 * own throwaway database. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 npx jest modules/cheques/cheques.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequesService } from './services/cheques.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const ds = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

const currencyStub = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;

describePg('Cheque lifecycle on PostgreSQL', () => {
  const dbName = `rx_chq_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let service: ChequesService;
  let accounting: AccountingService;
  let seq = 0;

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) => ds.query(sql, params) as Promise<R[]>;
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
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    accounting = new AccountingService(new AccountingRepository(new TenantScope(ds)), currencyStub);
    service = new ChequesService(new ChequesRepository(new TenantScope(ds)), accounting);
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
    await ds?.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
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
});
