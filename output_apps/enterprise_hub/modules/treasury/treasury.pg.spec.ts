/**
 * Treasury on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS, the raw-SQL
 * repository, the ledger postings and tenant isolation end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/treasury/treasury.pg.spec.ts
 */
import 'reflect-metadata';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { ChequesRepository } from '../cheques/repositories/cheques.repository';
import { ChequesService } from '../cheques/services/cheques.service';
import { CurrencyService } from '../currency/services/currency.service';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from './enums/treasury.enum';
import { TreasuryLedgerPostingAdapter } from './posting/treasury-ledger-posting.adapter';
import { TreasuryRepository } from './repositories/treasury.repository';
import { TreasuryService } from './services/treasury.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'treasury-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const INV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TABLES = ['fin_treasury_settings', 'fin_treasury_documents', 'fin_treasury_document_lines', 'fin_treasury_allocations'];

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

const invoices: Record<string, { number: string; payable: number }> = {
  [INV_A]: { number: 'F-1', payable: 1000 },
  [INV_B]: { number: 'F-2', payable: 500 },
};
const invoicing = {
  findOne: async (_t: string, id: string) => ({
    id,
    taxInvoiceNumber: invoices[id].number,
    finalPayable: invoices[id].payable,
    direction: InvoiceDirection.SALE,
    status: InvoiceStatus.ISSUED,
  }),
};

describePg('Treasury on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_treasury_${process.pid}_${Date.now()}`;
  const role = `rx_trs_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let repository: TreasuryRepository;
  let service: TreasuryService;

  const dto = (over: Record<string, unknown>) =>
    ({
      kind: TreasuryDocKind.RECEIPT,
      partyType: TreasuryPartyType.CUSTOMER,
      partyCode: 'C1',
      partyName: 'مشتری ۱',
      docDate: '2026-11-04',
      methods: [{ method: TreasuryMethod.CASH, amount: '1500' }],
      ...over,
    }) as never;

  /** The default chart may already hold the account; a duplicate is not an error here. */
  const ensure = async (tenantId: string, code: string, name: string, accountType: AccountType) => {
    try {
      await accounting.createAccount(tenantId, { code, name, accountType } as never);
    } catch (e) {
      if ((e as Error).constructor.name !== 'ConflictException') throw e;
    }
  };

  /** Net ledger position of a party on one account, in rials (debit - credit). */
  const partyBalance = async (tenantId: string, account: string, party: string): Promise<number> => {
    const rows = await app.transaction(async (m) => {
      await TenantScope.bind(m, tenantId);
      return m.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS bal
           FROM fin_journal_entry_lines l JOIN fin_chart_of_accounts a ON a.id = l.account_id
          WHERE a.code = $1 AND l.party_code = $2`,
        [account, party],
      );
    });
    return Number(rows[0].bal);
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
    repository = new TreasuryRepository(scope);
    for (const tenantId of [T1, T2]) {
      await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)]).catch(() => undefined);
      await ensure(tenantId, '1010', 'بانک', AccountType.ASSET);
      await ensure(tenantId, '1020', 'دریافتنی', AccountType.ASSET);
      await ensure(tenantId, '2010', 'پرداختنی', AccountType.LIABILITY);
      await ensure(tenantId, '4010', 'فروش', AccountType.REVENUE);
    }
    service = new TreasuryService(
      repository,
      new TreasuryLedgerPostingAdapter(accounting),
      { listAccounts: async () => [] } as never,
      new ChequesService(new ChequesRepository(scope), accounting, new PostingRulesService(new PostingRulesRepository(scope), accounting)),
      invoicing as never,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('runs as a non-superuser without BYPASSRLS and every treasury table has ENABLE + FORCE RLS with a policy', async () => {
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

  it('M1 flow: one receipt against two invoices clears the customer balance and balances the ledger', async () => {
    // the invoices put 1500 on the customer's receivable (what invoice posting does)
    await accounting.createJournalEntry(T1, {
      entryNumber: 'INV-M1',
      date: '2026-11-01T00:00:00.000Z',
      description: 'فروش',
      lines: [
        { accountCode: '1020', debit: '1500.00', credit: '0.00', partyCode: 'C1' },
        { accountCode: '4010', debit: '0.00', credit: '1500.00' },
      ],
    } as never);
    expect(await partyBalance(T1, '1020', 'C1')).toBe(1500);

    const created = await service.createDocument(
      T1,
      dto({ allocations: [{ invoiceId: INV_A, amount: '1000' }, { invoiceId: INV_B, amount: '500' }] }),
    );
    expect(created.docNumber).toBe('RC-000001');
    expect(created.advanceRemaining).toBe(0);
    expect(created.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([[INV_A, 1000], [INV_B, 500]]);
    expect(await partyBalance(T1, '1020', 'C1')).toBe(0);

    const [sums] = await app.transaction(async (m) => {
      await TenantScope.bind(m, T1);
      return m.query(`SELECT SUM(debit)::float AS d, SUM(credit)::float AS c FROM fin_journal_entry_lines`);
    });
    expect(sums.d).toBe(sums.c);
    // open amounts now zero for both invoices
    expect((await service.openInvoices(T1, TreasuryDocKind.RECEIPT, [INV_A, INV_B])).map((o) => o.outstanding)).toEqual([0, 0]);
  });

  it('two payments settle one invoice; a third that would overpay is refused', async () => {
    invoices['cccccccc-cccc-4ccc-8ccc-cccccccccccc'] = { number: 'F-3', payable: 1000 };
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await service.createDocument(T1, dto({ partyCode: 'C3', methods: [{ method: 'cash', amount: '600' }], allocations: [{ invoiceId: C, amount: '600' }] }));
    await service.createDocument(T1, dto({ partyCode: 'C3', methods: [{ method: 'cash', amount: '400' }], allocations: [{ invoiceId: C, amount: '400' }] }));
    await expect(
      service.createDocument(T1, dto({ partyCode: 'C3', methods: [{ method: 'cash', amount: '1' }], allocations: [{ invoiceId: C, amount: '1' }] })),
    ).rejects.toThrow('مانده صورتحساب');
  });

  it('concurrent payments cannot over-allocate the same invoice', async () => {
    invoices['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] = { number: 'F-4', payable: 1000 };
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const attempt = () =>
      service.createDocument(T1, dto({ partyCode: 'C4', methods: [{ method: 'cash', amount: '800' }], allocations: [{ invoiceId: D, amount: '800' }] }));
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [row] = await app.transaction(async (m) => {
      await TenantScope.bind(m, T1);
      return m.query(`SELECT SUM(amount)::float AS s FROM fin_treasury_allocations WHERE target_id = $1`, [D]);
    });
    expect(row.s).toBe(800);
  });

  it('advance: unallocated money is a liability, then moves onto an invoice later', async () => {
    const doc = await service.createDocument(T1, dto({ partyCode: 'C5', methods: [{ method: 'cash', amount: '700' }] }));
    expect(doc.advanceRemaining).toBe(700);
    expect(await partyBalance(T1, '2070', 'C5')).toBe(-700);
    invoices['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'] = { number: 'F-5', payable: 900 };
    const later = await service.allocateAdvance(T1, doc.id, { allocations: [{ invoiceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', amount: '700' }], date: '2026-11-05' });
    expect(later.advanceRemaining).toBe(0);
    expect(await partyBalance(T1, '2070', 'C5')).toBe(0);
  });

  it('a cheque line registers a cheque and the receivable is credited exactly once', async () => {
    await accounting.createJournalEntry(T1, {
      entryNumber: 'INV-CHQ',
      date: '2026-11-01T00:00:00.000Z',
      description: 'فروش',
      lines: [
        { accountCode: '1020', debit: '1000.00', credit: '0.00', partyCode: 'C6' },
        { accountCode: '4010', debit: '0.00', credit: '1000.00' },
      ],
    } as never);
    invoices['ffffffff-ffff-4fff-8fff-ffffffffffff'] = { number: 'F-6', payable: 1000 };
    const doc = await service.createDocument(
      T1,
      dto({
        partyCode: 'C6',
        methods: [
          { method: 'cash', amount: '400' },
          { method: 'cheque', amount: '600', chequeNumber: '555', dueDate: '2026-12-20' },
        ],
        allocations: [{ invoiceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', amount: '1000' }],
      }),
    );
    expect(doc.methods.find((m) => m.method === 'cheque')?.chequeId).toEqual(expect.any(Number));
    expect(await partyBalance(T1, '1020', 'C6')).toBe(0);
  });

  describe('tenant isolation', () => {
    it('another tenant sees none of the documents, lines or allocations', async () => {
      const mine = await repository.listDocuments(T1, {});
      expect(mine.length).toBeGreaterThan(0);
      expect(await repository.listDocuments(T2, {})).toEqual([]);
      expect(await repository.findDocument(T2, mine[0].id)).toBeNull();
      expect(await repository.listLines(T2, mine[0].id)).toEqual([]);
      expect(await repository.listAllocations(T2, {})).toEqual([]);
      await expect(service.getDocument(T2, mine[0].id)).rejects.toThrow('یافت نشد');
    });

    it('even a query with no tenant filter is cut off by RLS, and no scope means no rows', async () => {
      for (const table of TABLES) {
        const seen = await app.transaction(async (m) => {
          await TenantScope.bind(m, T2);
          return m.query(`SELECT tenant_id FROM ${table}`);
        });
        expect(seen.every((r: { tenant_id: string }) => r.tenant_id === T2)).toBe(true);
        expect(await app.query(`SELECT 1 FROM ${table}`)).toEqual([]);
      }
    });

    it('a write for the wrong tenant is rejected by the policy WITH CHECK', async () => {
      await expect(
        app.transaction(async (m) => {
          await TenantScope.bind(m, T2);
          await m.query(`INSERT INTO fin_treasury_settings (tenant_id, writeoff_tolerance) VALUES ($1, 5)`, [T1]);
        }),
      ).rejects.toThrow(/row-level security/);
    });

    it('document numbers are per tenant and gap-free', async () => {
      const n1 = await service.createDocument(T2, dto({ partyCode: 'X', methods: [{ method: 'cash', amount: '10' }] }));
      const n2 = await service.createDocument(T2, dto({ partyCode: 'X', methods: [{ method: 'cash', amount: '10' }] }));
      expect([n1.docNumber, n2.docNumber]).toEqual(['RC-000001', 'RC-000002']);
    });
  });
});
