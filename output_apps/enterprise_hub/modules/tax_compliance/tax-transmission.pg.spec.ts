/**
 * PostgreSQL integration spec for the T94 tax transmission core.
 * Runs the real repositories as a NOSUPERUSER NOBYPASSRLS role (roxira_app equivalent) with FORCE RLS.
 * Skipped unless ROXIRA_TEST_PG_HOST is set (CI only).
 */
import 'reflect-metadata';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { MoadianInvoiceSubject as S, MoadianSubmissionStatus as St } from './enums/moadian.enum';
import { TaxTransmissionEnvironment as E, TaxTransmissionMode as M } from './enums/tax-transmission.enum';
import { FiscalMemoryProfileRepository } from './repositories/fiscal-memory-profile.repository';
import { TaxTransmissionRepository } from './repositories/tax-transmission.repository';
import { TaxChainBlockedError } from './utils/tax-reference-chain';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'tax-transmission-test-only';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

describePg('Tax transmission core on PostgreSQL (NOSUPERUSER, FORCE RLS)', () => {
  const db = `rx_ttx_${process.pid}_${Date.now()}`;
  const role = `rx_ttx_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let profiles: FiscalMemoryProfileRepository;
  let outbox: TaxTransmissionRepository;
  let serialSeen = 0;

  const enqueue = (
    tenantId: string,
    invoiceId: string,
    ins: S,
    rootInvoiceId?: string,
    profileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ) =>
    outbox.enqueue(
      tenantId,
      {
        invoiceId,
        ins,
        rootInvoiceId,
        profileId,
        build: ({ serial, referenceTaxId }) => {
          serialSeen = serial;
          return { taxId: `TAX${String(serial).padStart(19, '0')}`, packet: { ref: referenceTaxId } };
        },
      },
      randomUUID,
    );

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
    const [roleRow] = await app.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`);
    expect(roleRow.rolsuper).toBe(false);
    expect(roleRow.rolbypassrls).toBe(false);

    for (const tenant of [T1, T2]) {
      await owner.query(
        `INSERT INTO "moadian_credentials" ("tenant_id","memory_id","economic_code","certificate_pem","private_key_sealed","key_fingerprint")
         VALUES ($1,'ABC123','12345678901234','pem','sealed','fp')`,
        [tenant],
      );
    }
    const scope = new TenantScope(app);
    profiles = new FiscalMemoryProfileRepository(scope);
    outbox = new TaxTransmissionRepository(scope);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('profiles: FORCE RLS is on and tenants are isolated', async () => {
    const [flags] = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'fiscal_memory_profiles'`,
    );
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const a = await profiles.create(T1, { memoryId: 'abc123', mode: M.DIRECT, environment: E.SANDBOX });
    await profiles.create(T1, { memoryId: 'ABC123', mode: M.TSP_TSP_KEY, environment: E.PRODUCTION, tspProvider: 'fake' });
    expect((await profiles.list(T1)).map((p) => p.memoryId)).toEqual(['ABC123', 'ABC123']);
    expect(await profiles.list(T2)).toEqual([]);
    expect(await profiles.findById(T2, a.id)).toBeNull();
    // A scoped update from another tenant touches nothing.
    await profiles.setActive(T2, a.id, false);
    expect((await profiles.findById(T1, a.id))?.active).toBe(true);
  });

  it('profiles: a tenant cannot write a row for another tenant, and no tenant means no rows', async () => {
    await expect(
      app.transaction(async (m) => {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T2]);
        await m.query(
          `INSERT INTO "fiscal_memory_profiles" ("tenant_id","memory_id","mode","environment") VALUES ($1,'ZZZ999','direct','sandbox')`,
          [T1],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
    expect(await app.query(`SELECT 1 FROM "fiscal_memory_profiles"`)).toEqual([]);
  });

  it('profiles: the memory id is unique per tenant and environment; CHECKs reject bad modes', async () => {
    await expect(profiles.create(T1, { memoryId: 'ABC123', mode: M.DIRECT, environment: E.SANDBOX })).rejects.toThrow(
      /duplicate key|unique/i,
    );
    await expect(
      app.transaction(async (m) => {
        await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [T1]);
        await m.query(
          `INSERT INTO "fiscal_memory_profiles" ("tenant_id","memory_id","mode","environment","tsp_provider") VALUES ($1,'QQQ111','direct','sandbox','x')`,
          [T1],
        );
      }),
    ).rejects.toThrow(/CHK_fiscal_memory_profiles_tsp/);
  });

  it('outbox: uid/taxid are fixed at creation; the same (tenant, invoice, ins) is idempotent', async () => {
    const first = await enqueue(T1, 'aaaaaaaa-0000-4000-8000-000000000001', S.MAIN);
    expect(first.created).toBe(true);
    expect(first.submission.status).toBe(St.QUEUED);
    expect(first.submission.activeReferenceTaxId).toBe(first.submission.taxId);
    const before = serialSeen;
    const again = await enqueue(T1, 'aaaaaaaa-0000-4000-8000-000000000001', S.MAIN);
    expect(again.created).toBe(false);
    expect(again.submission.id).toBe(first.submission.id);
    expect(again.submission.uid).toBe(first.submission.uid);
    expect(again.submission.taxId).toBe(first.submission.taxId);
    expect(serialSeen).toBe(before); // no second serial was built or burned
    // update() cannot move the identity
    await outbox.update(T1, first.submission.id, { status: St.UNKNOWN, uid: randomUUID(), taxId: 'HACK' } as never);
    const row = await outbox.findById(T1, first.submission.id);
    expect(row?.status).toBe(St.UNKNOWN);
    expect(row?.taxId).toBe(first.submission.taxId);
  });

  it('outbox: another tenant cannot read or change the row', async () => {
    const row = await outbox.findByInvoice(T1, 'aaaaaaaa-0000-4000-8000-000000000001', S.MAIN);
    expect(row).not.toBeNull();
    expect(await outbox.findById(T2, row!.id)).toBeNull();
    await outbox.update(T2, row!.id, { status: St.FAILED });
    expect((await outbox.findById(T1, row!.id))?.status).toBe(St.UNKNOWN);
  });

  it('reference chain: blocked while pending/unknown, then uses the latest confirmed taxid', async () => {
    const root = 'bbbbbbbb-0000-4000-8000-000000000001';
    const main = (await enqueue(T1, root, S.MAIN)).submission;

    // main still QUEUED -> blocked
    await expect(enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000a1', S.CORRECTIVE, root)).rejects.toBeInstanceOf(
      TaxChainBlockedError,
    );
    await outbox.update(T1, main.id, { status: St.UNKNOWN });
    await expect(enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000a1', S.CORRECTIVE, root)).rejects.toBeInstanceOf(
      TaxChainBlockedError,
    );

    await outbox.confirm(T1, (await outbox.findById(T1, main.id))!, [], 1);
    const a1 = (await enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000a1', S.CORRECTIVE, root)).submission;
    expect(a1.referenceTaxId).toBe(main.taxId);
    expect(a1.rootInvoiceId).toBe(root);
    expect(a1.profileId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

    // a1 pending -> a return is blocked
    await expect(enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000b1', S.RETURN, root)).rejects.toBeInstanceOf(
      TaxChainBlockedError,
    );

    await outbox.confirm(T1, a1, [], 1);
    expect((await outbox.findByInvoice(T1, root, S.MAIN))?.activeReferenceTaxId).toBe(a1.taxId);
    const ret = (await enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000b1', S.RETURN, root)).submission;
    expect(ret.referenceTaxId).toBe(a1.taxId);

    // a FAILED return neither blocks nor moves the reference
    await outbox.update(T1, ret.id, { status: St.FAILED });
    const cancel = (await enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000c1', S.CANCELLATION, root)).submission;
    expect(cancel.referenceTaxId).toBe(a1.taxId);

    // after a confirmed cancellation the chain is closed
    await outbox.confirm(T1, cancel, [], 1);
    await expect(enqueue(T1, 'bbbbbbbb-0000-4000-8000-0000000000d1', S.CORRECTIVE, root)).rejects.toBeInstanceOf(
      TaxChainBlockedError,
    );
  });

  it('reference chain: another tenant cannot hang a document on this tenant\'s root', async () => {
    await expect(
      enqueue(T2, 'bbbbbbbb-0000-4000-8000-0000000000e1', S.CORRECTIVE, 'bbbbbbbb-0000-4000-8000-000000000001'),
    ).rejects.toBeInstanceOf(TaxChainBlockedError);
  });
});
