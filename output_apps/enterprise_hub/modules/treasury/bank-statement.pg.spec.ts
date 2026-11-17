/**
 * T184 bank statement import on a REAL PostgreSQL as a non-superuser role (NOSUPERUSER NOBYPASSRLS):
 * R16 Test 9 end to end through the real service, repository, posting roles and ledger, plus
 * idempotent re-import and cross-tenant isolation.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55672 npx jest modules/treasury/bank-statement.pg.spec.ts
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { BankStatementRepository } from './repositories/bank-statement.repository';
import { TreasuryRepository } from './repositories/treasury.repository';
import { BankStatementService } from './services/bank-statement.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'bank-statement-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';
const IBAN = 'DE89370400440532013000';
const TABLES = ['fin_bank_stmt_imports', 'fin_bank_stmt_lines', 'fin_bank_stmt_matches', 'fin_bank_stmt_match_allocations'];

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'statement', '__fixtures__', name), 'utf8');
const CAMT = fixture('camt053-test9.xml');
const MT940 = fixture('mt940-test9.txt');
const mt940 = (lines: string) => `:20:X\n:25:${IBAN}\n:28C:1/1\n${lines}\n`;

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

type Inv = { id: string; number: string; payable: number; partyCode: string; status: InvoiceStatus };
const INV: Record<string, Inv> = {
  'a0000000-0000-4000-8000-000000000101': { id: 'a0000000-0000-4000-8000-000000000101', number: 'INV-101', payable: 1190, partyCode: 'C1', status: InvoiceStatus.ISSUED },
  'a0000000-0000-4000-8000-000000000102': { id: 'a0000000-0000-4000-8000-000000000102', number: 'INV-102', payable: 600, partyCode: 'C2', status: InvoiceStatus.ISSUED },
  'a0000000-0000-4000-8000-000000000103': { id: 'a0000000-0000-4000-8000-000000000103', number: 'INV-103', payable: 400, partyCode: 'C2', status: InvoiceStatus.ISSUED },
};
const ID101 = 'a0000000-0000-4000-8000-000000000101';
const ID102 = 'a0000000-0000-4000-8000-000000000102';
const ID103 = 'a0000000-0000-4000-8000-000000000103';
const ID104 = 'a0000000-0000-4000-8000-000000000104';
const toDto = (i: Inv) => ({
  id: i.id,
  taxInvoiceNumber: i.number,
  finalPayable: i.payable,
  direction: InvoiceDirection.SALE,
  status: i.status,
  buyerInfo: { partyCode: i.partyCode },
  issuedAt: new Date('2026-10-20T00:00:00Z'),
  createdAt: new Date('2026-10-20T00:00:00Z'),
});
const invoicing = {
  findOne: async (_t: string, id: string) => toDto(INV[id]),
  findAll: async () => ({ data: Object.values(INV).map(toDto), total: Object.keys(INV).length, page: 1, limit: 100 }),
};

describePg('Bank statement import on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_stmt_${process.pid}_${Date.now()}`;
  const role = `rx_stmt_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let service: BankStatementService;
  const bankAccountId: Record<string, number> = {};

  const ensure = async (tenantId: string, code: string, name: string, accountType: AccountType) => {
    try {
      await accounting.createAccount(tenantId, { code, name, accountType } as never);
    } catch (e) {
      if ((e as Error).constructor.name !== 'ConflictException') throw e;
    }
  };

  const asApp = <T>(tenantId: string, sql: string, params: unknown[] = []): Promise<T> =>
    app.transaction(async (m) => {
      await TenantScope.bind(m, tenantId);
      return m.query(sql, params);
    }) as Promise<T>;

  /** Ledger lines of one voucher: [account code, debit, credit, party]. */
  const voucher = async (tenantId: string, entryNumber: string) =>
    (
      await asApp<Array<{ code: string; debit: string; credit: string; party_code: string | null }>>(
        tenantId,
        `SELECT a.code, l.debit::text, l.credit::text, l.party_code
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id
           JOIN fin_chart_of_accounts a ON a.id = l.account_id
          WHERE e.entry_number = $1 ORDER BY l.id`,
        [entryNumber],
      )
    ).map((r) => [r.code, r.debit, r.credit, r.party_code]);

  const counts = async (tenantId: string) => {
    const one = async (sql: string) => Number((await asApp<Array<{ n: string }>>(tenantId, sql))[0].n);
    return {
      lines: await one(`SELECT count(*) AS n FROM fin_bank_stmt_lines`),
      matches: await one(`SELECT count(*) AS n FROM fin_bank_stmt_matches`),
      entries: await one(`SELECT count(*) AS n FROM fin_journal_entries WHERE entry_number LIKE 'BSM-%'`),
    };
  };

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();

    const scope = new TenantScope(app);
    const currencyStub = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(new AccountingRepository(scope), currencyStub);
    for (const tenantId of [T1, T2]) {
      await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)]).catch(() => undefined);
      await ensure(tenantId, '1012', 'بانک', AccountType.ASSET);
      await ensure(tenantId, '1020', 'دریافتنی', AccountType.ASSET);
      await ensure(tenantId, '5210', 'کارمزد بانکی', AccountType.EXPENSE);
      const [ledger] = await asApp<Array<{ id: number }>>(tenantId, `SELECT id FROM fin_chart_of_accounts WHERE code = '1012'`);
      const [acct] = await owner.query(
        `INSERT INTO fin_bank_accounts (tenant_id, name, bank_code, account_number, iban, ledger_account_id, currency)
         VALUES ($1, 'Main EUR', 'other', '0532013000', $2, $3, 'EUR') RETURNING id`,
        [tenantId, IBAN, ledger.id],
      );
      bankAccountId[tenantId] = acct.id;
    }

    const banking = {
      listAccounts: async (tenantId: string) => [
        { id: bankAccountId[tenantId], accountNumber: '0532013000', iban: IBAN, currency: 'EUR', ledgerAccountCode: '1012' },
      ],
    };
    service = new BankStatementService(
      new BankStatementRepository(scope),
      new TreasuryRepository(scope),
      banking as never,
      invoicing as never,
      accounting,
      new PostingRulesService(new PostingRulesRepository(scope), accounting),
    );
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('runs as a non-superuser without BYPASSRLS and every statement table has ENABLE + FORCE RLS with a policy', async () => {
    const [r] = await app.query(`SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`);
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const rows = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = ANY($1)`,
      [TABLES],
    );
    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  let tx2LineId: string;

  it('Test 9: TX-1 auto-matches INV-101; TX-2 waits with a suggestion of 600 + 400 and a 30.00 fee', async () => {
    const result = await service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: CAMT });
    expect(result).toMatchObject({ format: 'camt053', totalLines: 2, newLines: 2, duplicateLines: 0, autoMatched: 1 });

    const lines = await service.listLines(T1, { bankAccountId: bankAccountId[T1] });
    const tx1 = lines.find((l) => l.bankTxnId === 'TX-1');
    const tx2 = lines.find((l) => l.bankTxnId === 'TX-2');
    expect(tx1).toMatchObject({ status: 'matched', amount: '1190.00', direction: 'credit', bookingDate: '2026-11-02' });
    expect(tx1?.match).toMatchObject({ rule: 'reference', auto: true, fee: '0.00' });
    expect(tx1?.match?.allocations).toEqual([{ invoiceId: ID101, invoiceNumber: 'INV-101', amount: '1190.00' }]);
    expect(await voucher(T1, `BSM-${tx1?.id}`)).toEqual([
      ['1012', '1190.00', '0.00', null],
      ['1020', '0.00', '1190.00', 'C1'],
    ]);

    expect(tx2).toMatchObject({ status: 'unmatched', amount: '970.00', match: null });
    expect(tx2?.suggestion).toMatchObject({ rule: 'reference', auto: false, fee: '30.00' });
    expect(tx2?.suggestion?.allocations).toEqual([
      { invoiceId: ID102, invoiceNumber: 'INV-102', amount: '600.00' },
      { invoiceId: ID103, invoiceNumber: 'INV-103', amount: '400.00' },
    ]);
    tx2LineId = tx2?.id as string;
  });

  it('Test 9: confirming TX-2 posts ONE voucher: Dr bank 970 + Dr fees 30 / Cr AR 600 + Cr AR 400, with a stored explanation', async () => {
    const before = await counts(T1);
    const match = await service.confirmMatch(T1, USER, tx2LineId, {});
    expect(match).toMatchObject({ rule: 'reference', auto: false, fee: '30.00' });
    expect(match.explanation).toMatchObject({ rule: 'reference', bankTxnId: 'TX-2', amount: '970.00', fee: '30.00' });
    expect((match.explanation as { text: string }).text).toContain('bank fee');

    expect(await voucher(T1, `BSM-${tx2LineId}`)).toEqual([
      ['1012', '970.00', '0.00', null],
      ['5210', '30.00', '0.00', null],
      ['1020', '0.00', '600.00', 'C2'],
      ['1020', '0.00', '400.00', 'C2'],
    ]);
    expect(await counts(T1)).toEqual({ ...before, matches: before.matches + 1, entries: before.entries + 1 });

    const stored = await asApp<Array<{ invoice_number: string; amount: string }>>(
      T1,
      `SELECT a.invoice_number, a.amount::text FROM fin_bank_stmt_match_allocations a ORDER BY a.invoice_number`,
    );
    expect(stored.filter((r) => r.invoice_number !== 'INV-101')).toEqual([
      { invoice_number: 'INV-102', amount: '600.00' },
      { invoice_number: 'INV-103', amount: '400.00' },
    ]);
    // the books balance
    const [sums] = await asApp<Array<{ d: string; c: string }>>(T1, `SELECT SUM(debit)::text AS d, SUM(credit)::text AS c FROM fin_journal_entry_lines`);
    expect(sums.d).toBe(sums.c);
  });

  it('importing the same file again, in either format, creates no duplicate lines, matches or postings', async () => {
    const before = await counts(T1);
    expect(before).toEqual({ lines: 2, matches: 2, entries: 2 });
    const again = await service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: CAMT });
    expect(again).toMatchObject({ totalLines: 2, newLines: 0, duplicateLines: 2, autoMatched: 0 });
    const asMt940 = await service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: MT940 });
    expect(asMt940).toMatchObject({ format: 'mt940', totalLines: 2, newLines: 0, duplicateLines: 2, autoMatched: 0 });
    expect(await counts(T1)).toEqual(before);
  });

  it('a matched line cannot be confirmed twice, and settled invoices are no longer suggested', async () => {
    await expect(service.confirmMatch(T1, USER, tx2LineId, {})).rejects.toBeInstanceOf(ConflictException);
    await service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: mt940(':61:2611040104C1190,00NTRFNONREF//TX-9\n:86:INV-101 again') });
    const lines = await service.listLines(T1, { bankAccountId: bankAccountId[T1], status: 'unmatched' });
    expect(lines.map((l) => [l.bankTxnId, l.suggestion])).toEqual([['TX-9', null]]);
  });

  it('manual one-to-many: wrong totals and over-allocation are refused and roll everything back; a correct split posts once', async () => {
    INV[ID104] = { id: ID104, number: 'INV-104', payable: 500, partyCode: 'C3', status: InvoiceStatus.ISSUED };
    await service.importStatement(T1, USER, {
      bankAccountId: bankAccountId[T1],
      autoMatch: false,
      content: mt940(':61:2611050105C490,00NTRFNONREF//TX-10\n:86:remittance without a number'),
    });
    const line = (await service.listLines(T1, { bankAccountId: bankAccountId[T1], status: 'unmatched' })).find((l) => l.bankTxnId === 'TX-10');
    expect(line?.suggestion).toBeNull();
    const id = line?.id as string;
    const before = await counts(T1);

    // total does not equal amount + fee
    await expect(service.confirmMatch(T1, USER, id, { allocations: [{ invoiceId: ID104, amount: '500.00' }] })).rejects.toBeInstanceOf(BadRequestException);
    // more than the invoice has open (INV-101 is fully settled)
    await expect(
      service.confirmMatch(T1, USER, id, { allocations: [{ invoiceId: ID101, amount: '490.00' }] }),
    ).rejects.toThrow(/مانده باز/);
    // the same invoice twice
    await expect(
      service.confirmMatch(T1, USER, id, { allocations: [{ invoiceId: ID104, amount: '245.00' }, { invoiceId: ID104, amount: '245.00' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await counts(T1)).toEqual(before);
    expect((await service.listLines(T1, { bankAccountId: bankAccountId[T1], status: 'unmatched' })).some((l) => l.id === id)).toBe(true);

    // 490 received + 10 fee = 500 against INV-104
    const ok = await service.confirmMatch(T1, USER, id, { allocations: [{ invoiceId: ID104, amount: '500.00' }], fee: '10.00', note: 'bank charged 10' });
    expect(ok).toMatchObject({ rule: 'manual', auto: false, fee: '10.00' });
    expect(await voucher(T1, `BSM-${id}`)).toEqual([
      ['1012', '490.00', '0.00', null],
      ['5210', '10.00', '0.00', null],
      ['1020', '0.00', '500.00', 'C3'],
    ]);
  });

  it('two concurrent confirms of one line post exactly once', async () => {
    await service.importStatement(T1, USER, {
      bankAccountId: bankAccountId[T1],
      autoMatch: false,
      content: mt940(':61:2611060106C100,00NTRFNONREF//TX-11\n:86:x'),
    });
    INV['a0000000-0000-4000-8000-000000000105'] = { id: 'a0000000-0000-4000-8000-000000000105', number: 'INV-105', payable: 100, partyCode: 'C4', status: InvoiceStatus.ISSUED };
    const id = (await service.listLines(T1, { bankAccountId: bankAccountId[T1], status: 'unmatched' })).find((l) => l.bankTxnId === 'TX-11')?.id as string;
    const body = { allocations: [{ invoiceId: 'a0000000-0000-4000-8000-000000000105', amount: '100.00' }] };
    const results = await Promise.allSettled([service.confirmMatch(T1, USER, id, body), service.confirmMatch(T1, USER, id, body)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await voucher(T1, `BSM-${id}`)).toHaveLength(2);
  });

  it('refuses a statement for another account, another currency, or malformed content', async () => {
    const wrongAccount = mt940(':61:2611070107C1,00NTRFX//Z1\n').replace(IBAN, 'DE00000000000000000000');
    await expect(service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: wrongAccount })).rejects.toThrow(/شمارهٔ حساب/);
    const wrongCurrency = CAMT.replace(/Ccy="EUR"/g, 'Ccy="USD"').replace('<Ccy>EUR</Ccy>', '<Ccy>USD</Ccy>');
    await expect(service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: wrongCurrency })).rejects.toThrow(/ارز/);
    await expect(service.importStatement(T1, USER, { bankAccountId: bankAccountId[T1], content: '<a><b></a>' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importStatement(T1, USER, { bankAccountId: 999999, content: CAMT })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('RLS: tenant 2 sees none of tenant 1 lines, matches or allocations, cannot confirm them, and imports the same bank ids on its own', async () => {
    for (const table of TABLES) {
      expect(await asApp<unknown[]>(T2, `SELECT * FROM ${table}`)).toHaveLength(0);
      expect((await asApp<Array<{ n: string }>>(T1, `SELECT count(*) AS n FROM ${table}`))[0].n).not.toBe('0');
    }
    expect(await service.listLines(T2, { bankAccountId: bankAccountId[T1] })).toEqual([]);
    await expect(service.confirmMatch(T2, USER, tx2LineId, {})).rejects.toBeInstanceOf(NotFoundException);

    // a statement line forged for tenant 1 from a tenant 2 session is rejected by WITH CHECK
    await expect(
      asApp(
        T2,
        `INSERT INTO fin_bank_stmt_lines (tenant_id, bank_account_id, import_id, bank_txn_id, booking_date, amount, direction)
         VALUES ($1, $2, gen_random_uuid(), 'FORGED', '2026-11-01', 1, 'credit')`,
        [T1, bankAccountId[T1]],
      ),
    ).rejects.toThrow(/row-level security/);

    // same bank transaction ids in another tenant are separate rows (the unique key includes tenant_id)
    const own = await service.importStatement(T2, USER, { bankAccountId: bankAccountId[T2], content: CAMT, autoMatch: false });
    expect(own).toMatchObject({ newLines: 2, duplicateLines: 0 });
    expect((await counts(T2)).lines).toBe(2);
  });
});
