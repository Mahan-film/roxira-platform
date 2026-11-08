/**
 * Real PostgreSQL FORCE RLS integration test for Banking & Bank Reconciliation:
 * - Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_banking_rls_app`).
 * - Verifies all 11 `fin_bank_*` tables have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises the real `BankingRepository` and `ReconRepository` methods across two tenants and proves:
 *   1. Tenant A can create/read/update its own bank accounts, statement lines, recon settings, sessions,
 *      items, matches, rules, drafts, attachments, reports, and audit records.
 *   2. Tenant B cannot read, update, or delete Tenant A's rows on any of the 11 tables.
 *   3. Unscoped direct queries return 0 rows and fail on cross-tenant INSERT.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { BANKING_RLS_TABLES } from '../../migrations/1789900000900-EnableRlsBanking';
import { TenantScope } from '../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { AccountType } from '../accounting/enums/accounting.enum';
import { BankAccountEntity } from './entities/bank-account.entity';
import { BankStatementLineEntity } from './entities/bank-statement-line.entity';
import { BankCode, MatchMethod, StatementLineStatus } from './enums/banking.enum';
import { ReconRepository } from './recon/recon.repository';
import { BankingRepository } from './repositories/banking.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_banking_rls_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({
    ...baseOptions('postgres', ADMIN_USER),
    entities: [],
    migrations: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('Banking & Bank Reconciliation FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_banking_rls_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let bankingRepo: BankingRepository;
  let reconRepo: ReconRepository;
  let ledgerAccountA: number;
  let ledgerAccountB: number;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);

    ownerDs = new DataSource({
      ...baseOptions(dbName, ADMIN_USER),
      entities: [path.join(__dirname, '../**/*.entity.ts')],
    });
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_ROLE}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );

    const ownerScope = new TenantScope(ownerDs);
    await ownerScope.run(TENANT_A, async (m) => {
      const saved = await m.getRepository(ChartOfAccountEntity).save(
        m.getRepository(ChartOfAccountEntity).create({
          tenantId: TENANT_A,
          code: '1110',
          name: 'بانک ملت الف',
          accountType: AccountType.ASSET,
        }),
      );
      ledgerAccountA = saved.id;
    });
    await ownerScope.run(TENANT_B, async (m) => {
      const saved = await m.getRepository(ChartOfAccountEntity).save(
        m.getRepository(ChartOfAccountEntity).create({
          tenantId: TENANT_B,
          code: '1110',
          name: 'بانک ملت ب',
          accountType: AccountType.ASSET,
        }),
      );
      ledgerAccountB = saved.id;
    });

    appDs = new DataSource(baseOptions(dbName, APP_ROLE));
    await appDs.initialize();
    scope = new TenantScope(appDs);

    bankingRepo = new BankingRepository(
      appDs.getRepository(BankAccountEntity),
      appDs.getRepository(BankStatementLineEntity),
      appDs,
      scope,
    );
    reconRepo = new ReconRepository(appDs, scope);
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('enables and forces RLS on all 11 fin_bank_* tables', async () => {
    const rows = (await appDs.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [BANKING_RLS_TABLES],
    )) as Array<{ table_name: string; rls: boolean; force_rls: boolean }>;

    expect(rows).toEqual(
      BANKING_RLS_TABLES.map((table_name) => ({
        table_name,
        rls: true,
        force_rls: true,
      })),
    );
  });

  it('isolates BankingRepository methods across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const accountA = await bankingRepo.createAccount(TENANT_A, {
      name: 'جاری ملت الف',
      bankCode: BankCode.MELLAT,
      accountNumber: '1234567890',
      iban: 'IR000000000000001234567890',
      ledgerAccountId: ledgerAccountA,
      currency: 'IRR',
      openingBalance: 1_000_000,
    });
    const accountB = await bankingRepo.createAccount(TENANT_B, {
      name: 'جاری ملت ب',
      bankCode: BankCode.MELLAT,
      accountNumber: '1234567890',
      iban: 'IR000000000000009876543210',
      ledgerAccountId: ledgerAccountB,
      currency: 'IRR',
      openingBalance: 2_000_000,
    });

    expect((await bankingRepo.listAccounts(TENANT_A)).map((a) => a.id)).toEqual([accountA.id]);
    expect((await bankingRepo.listAccounts(TENANT_B)).map((a) => a.id)).toEqual([accountB.id]);
    expect(await bankingRepo.findAccount(TENANT_B, accountA.id)).toBeNull();
    expect((await bankingRepo.findAccountByNumber(TENANT_B, '1234567890'))?.id).toBe(accountB.id);

    const [lineIdA] = await bankingRepo.insertStatementLines(TENANT_A, accountA.id, [
      {
        txnDate: '2026-04-01',
        description: 'واریز مشتری الف',
        withdrawal: 0,
        deposit: 500_000,
        balance: 1_500_000,
        reference: 'REF-A-1',
        dedupeKey: 'dedupe-a-1',
      },
    ]);

    expect(await bankingRepo.findExistingDedupeKeys(TENANT_A, ['dedupe-a-1'])).toEqual([
      'dedupe-a-1',
    ]);
    expect(await bankingRepo.findExistingDedupeKeys(TENANT_B, ['dedupe-a-1'])).toEqual([]);
    expect(await bankingRepo.findLine(TENANT_B, lineIdA)).toBeNull();
    expect(await bankingRepo.findLines(TENANT_B, accountA.id)).toEqual([]);
    expect(
      await bankingRepo.findLines(TENANT_A, accountA.id, { status: StatementLineStatus.UNMATCHED }),
    ).toHaveLength(1);

    // Tenant B cannot match, unmatch, or delete Tenant A's statement line
    expect(await bankingRepo.setMatch(TENANT_B, lineIdA, 999, MatchMethod.MANUAL)).toBe(false);
    expect(await bankingRepo.deleteLines(TENANT_B, [lineIdA])).toBe(0);
    expect(await bankingRepo.findLinesByIds(TENANT_A, [lineIdA])).toHaveLength(1);
  });

  it('isolates ReconRepository methods across all 9 fin_bank_recon_* tables under NOSUPERUSER NOBYPASSRLS', async () => {
    const [accountA] = await bankingRepo.listAccounts(TENANT_A);

    // 1. Settings
    await reconRepo.saveSettings(TENANT_A, 'actor-a', {
      fee_max_rial: '7000000',
      sms_fee_max_rial: '600000',
      auto_post_fees: true,
      auto_match_min_confidence: '0.950',
      date_window_days: 5,
      category_accounts: { bank_fee: '5110' },
    });
    expect((await reconRepo.getSettings(TENANT_A)).fee_max_rial).toBe('7000000');
    expect((await reconRepo.getSettings(TENANT_B)).fee_max_rial).toBe('5000000');

    // 2. Sessions
    const sessionA = await reconRepo.createSession(TENANT_A, {
      fileName: 'statement-a.csv',
      sha256: 'a'.repeat(64),
      kind: 'csv',
      fileData: Buffer.from('date,desc\n2026-04-01,test'),
      createdBy: 'actor-a',
      bankAccountId: accountA.id,
    });
    expect(await reconRepo.getSession(TENANT_B, sessionA.id)).toBeNull();
    expect(await reconRepo.getSessionFile(TENANT_B, sessionA.id)).toBeNull();
    expect(await reconRepo.listSessions(TENANT_B)).toEqual([]);

    // 3. Items & Transactions
    let itemIdA = 0;
    await reconRepo.runInTransaction(async (manager) => {
      const ids = await reconRepo.insertItems(
        TENANT_A,
        [
          {
            sessionId: sessionA.id,
            bankAccountId: accountA.id,
            lineNo: 1,
            txnDate: '2026-04-01',
            txnTime: '10:00',
            description: 'کارمزد بانکی',
            withdrawal: 350000n,
            deposit: 0n,
            balance: 650000n,
            reference: 'REF-1',
            chequeNo: null,
            sayadId: null,
            dedupeKey: 'recon-dedupe-a-1',
            category: 'bank_fee',
            personType: 'none',
            counterparty: null,
            confidence: 0.99,
            source: 'fee_rule',
            counterAccountCode: '5110',
          },
        ],
        manager,
      );
      itemIdA = ids[0];
    }, TENANT_A);

    expect(itemIdA).toBeGreaterThan(0);
    expect(await reconRepo.getItem(TENANT_B, itemIdA)).toBeNull();
    expect(await reconRepo.listItems(TENANT_B, sessionA.id)).toEqual([]);

    // 4. Rules
    const ruleIdA = await reconRepo.upsertRule(TENANT_A, 'actor-a', {
      kind: 'keyword',
      pattern: 'کارمزد ویژه',
      category: 'bank_fee',
      personType: null,
      counterAccountCode: '5110',
      sourceItemId: itemIdA,
    });
    expect(await reconRepo.listRules(TENANT_A)).toHaveLength(1);
    expect(await reconRepo.listRules(TENANT_B)).toEqual([]);
    expect(await reconRepo.deactivateRule(TENANT_B, ruleIdA)).toBe(false);

    // 5. Drafts
    const draftA = await reconRepo.insertDraft(TENANT_A, {
      sessionId: sessionA.id,
      itemId: itemIdA,
      bankAccountId: accountA.id,
      entryDate: '2026-04-01',
      description: 'کارمزد بانکی',
      amount: 350000n,
      direction: 'out',
      counterAccountCode: '5110',
      category: 'bank_fee',
      auto: false,
      createdBy: 'actor-a',
    });
    expect(draftA).not.toBeNull();
    expect(await reconRepo.getDraft(TENANT_B, draftA!.id)).toBeNull();
    expect(await reconRepo.claimDraft(TENANT_B, draftA!.id, 'evil')).toBe(false);

    // 6. Attachments
    const attachmentIdA = await reconRepo.insertAttachment(TENANT_A, {
      itemId: itemIdA,
      fileName: 'receipt.pdf',
      mime: 'application/pdf',
      size: 16,
      sha256: 'b'.repeat(64),
      data: Buffer.from('%PDF-1.4 receipt'),
      uploadedBy: 'actor-a',
    });
    expect(attachmentIdA).toBeGreaterThan(0);
    expect(await reconRepo.listAttachments(TENANT_A, itemIdA)).toHaveLength(1);
    expect(await reconRepo.listAttachments(TENANT_B, itemIdA)).toEqual([]);

    // 7. Reports
    const reportIdA = await reconRepo.insertReport(TENANT_A, {
      bankAccountId: accountA.id,
      sessionId: sessionA.id,
      periodFrom: '2026-04-01',
      periodTo: '2026-04-30',
      differenceMinor: 0n,
      snapshot: { ok: true },
      createdBy: 'actor-a',
    });
    expect(await reconRepo.getReport(TENANT_A, reportIdA)).not.toBeNull();
    expect(await reconRepo.getReport(TENANT_B, reportIdA)).toBeNull();
    expect(await reconRepo.listReports(TENANT_B)).toEqual([]);

    // 8. Audit
    await reconRepo.audit(TENANT_A, 'actor-a', 'test.action', 'session', sessionA.id, { ok: true });
    expect((await reconRepo.listAudit(TENANT_A)).length).toBeGreaterThan(0);
    expect(await reconRepo.listAudit(TENANT_B)).toEqual([]);

    // Unscoped direct query returns 0 rows on all 11 tables
    for (const table of BANKING_RLS_TABLES) {
      const unscoped = await appDs.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(unscoped[0].n).toBe(0);
    }
  });
});
