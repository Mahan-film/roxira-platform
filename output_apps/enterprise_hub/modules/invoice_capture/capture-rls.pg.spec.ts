/**
 * Real PostgreSQL FORCE RLS test for Invoice Capture (`capture_*` — 6 tables) (#475, #621).
 * Connects as a `NOSUPERUSER NOBYPASSRLS` role and exercises real `CaptureRepository` methods
 * across two tenants.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  CAPTURE_RLS_TABLES,
  EnableRlsCapture1789900000800,
} from '../../migrations/1789900000800-EnableRlsCapture';
import { TenantScope } from '../access/services/tenant-scope';
import {
  CaptureAuditEntity,
  CaptureDocumentEntity,
  CaptureFileEntity,
  CaptureSettingsEntity,
  CaptureVendorEntity,
  CaptureVendorRuleEntity,
} from './entities/capture.entities';
import { CaptureRepository } from './repositories/capture.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'capture-rls-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [
    CaptureDocumentEntity,
    CaptureFileEntity,
    CaptureVendorEntity,
    CaptureVendorRuleEntity,
    CaptureSettingsEntity,
    CaptureAuditEntity,
  ],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Invoice Capture FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS, real repository methods) (#621)', () => {
  const db = `rx_cap_rls_${process.pid}_${Date.now()}`;
  const role = `rx_cap_rls_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let repo: CaptureRepository;

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
    scope = new TenantScope(app);
    repo = new CaptureRepository(
      app.getRepository(CaptureDocumentEntity),
      app.getRepository(CaptureFileEntity),
      app.getRepository(CaptureVendorEntity),
      app.getRepository(CaptureVendorRuleEntity),
      app.getRepository(CaptureSettingsEntity),
      app.getRepository(CaptureAuditEntity),
      scope,
    );

    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tenantId,
          tenantId.slice(0, 8),
        ])
        .catch(() => undefined);
    }
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('enables and forces RLS with policy on all 6 capture tables', async () => {
    const rows = (await owner.query(
      `SELECT c.relname AS table_name,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
        WHERE c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [CAPTURE_RLS_TABLES],
    )) as Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policies: number }>;

    expect(rows).toEqual(
      CAPTURE_RLS_TABLES.map((table_name) => ({
        table_name,
        rls_enabled: true,
        rls_forced: true,
        policies: 1,
      })),
    );
  });

  it('isolates CaptureRepository methods across all 6 tables under NOSUPERUSER NOBYPASSRLS', async () => {
    // 1. capture_vendors & capture_vendor_rules
    const vendorA = await repo.saveVendor({
      tenantId: T1,
      name: 'فروشنده الف',
      normalizedName: 'فروشنده الف',
      taxId: '10101010101',
    });
    const vendorB = await repo.saveVendor({
      tenantId: T2,
      name: 'فروشنده ب',
      normalizedName: 'فروشنده ب',
      taxId: '20202020202',
    });

    expect((await repo.findVendor(T1, vendorA.id))?.name).toBe('فروشنده الف');
    expect((await repo.findVendorByTaxId(T1, '10101010101'))?.id).toBe(vendorA.id);
    expect((await repo.findVendorByName(T1, 'فروشنده الف'))?.id).toBe(vendorA.id);
    expect(await repo.findVendor(T2, vendorA.id)).toBeNull();
    expect((await repo.listVendors(T2, [vendorA.id, vendorB.id])).map((v) => v.id)).toEqual([
      vendorB.id,
    ]);

    const ruleA = await repo.saveRule(
      Object.assign(new CaptureVendorRuleEntity(), {
        vendorId: vendorA.id,
        tenantId: T1,
        accountCode: '5010',
        autoPost: true,
        maxAmountIrr: '10000000',
        updatedBy: 'user-a',
      }),
    );
    expect((await repo.findRule(T1, vendorA.id))?.accountCode).toBe('5010');
    expect(await repo.findRule(T2, vendorA.id)).toBeNull();
    expect(await repo.listRules(T2)).toEqual([]);
    expect(ruleA.vendorId).toBe(vendorA.id);

    // 2. capture_settings
    await repo.saveSettings(
      Object.assign(new CaptureSettingsEntity(), {
        tenantId: T1,
        autoEnabled: true,
        minConfidence: '0.950',
        dailyCostCapUsd: '5.00',
        dailyDocCap: 50,
        updatedBy: 'admin-a',
      }),
    );
    expect((await repo.findSettings(T1))?.autoEnabled).toBe(true);
    expect(await repo.findSettings(T2)).toBeNull();

    // 3. capture_documents, capture_files, capture_audit
    const docA = await repo.saveDocument({
      tenantId: T1,
      status: 'needs_review',
      sourceKind: 'image',
      sourceSha256: 'a'.repeat(64),
      extracted: { draft: { kind: 'purchase', total: 1000 } },
      confidence: '0.920',
      costUsd: '0.015000',
      dedupeKey: 'DEDUPE-A1',
      createdBy: 'user-a',
    });

    await repo.saveFile(
      Object.assign(new CaptureFileEntity(), {
        documentId: docA.id,
        tenantId: T1,
        mime: 'image/png',
        bytes: Buffer.from('png-bytes-a'),
      }),
    );
    await repo.addAudit({
      tenantId: T1,
      documentId: docA.id,
      action: 'created',
      actor: 'user-a',
      sourceSha256: 'a'.repeat(64),
      model: 'test-model',
      detail: { ok: true },
    });

    // Tenant 1 reads its document, file, audit, queue, and usage
    expect((await repo.findDocument(T1, docA.id))?.id).toBe(docA.id);
    expect((await repo.findFile(T1, docA.id))?.mime).toBe('image/png');
    expect(await repo.listAudit(T1, docA.id)).toHaveLength(1);
    expect((await repo.listQueue(T1, new Date(Date.now() - 60_000))).map((d) => d.id)).toEqual([
      docA.id,
    ]);
    expect((await repo.listRecent(T1, 10)).map((d) => d.id)).toEqual([docA.id]);
    expect(await repo.usageSince(T1, new Date(Date.now() - 60_000))).toEqual({
      costUsd: 0.015,
      documents: 1,
    });

    // Tenant 2 sees nothing of Tenant 1 and cannot transition Tenant 1's document
    expect(await repo.findDocument(T2, docA.id)).toBeNull();
    expect(await repo.findFile(T2, docA.id)).toBeNull();
    expect(await repo.listAudit(T2, docA.id)).toEqual([]);
    expect(await repo.listQueue(T2, new Date(Date.now() - 60_000))).toEqual([]);
    expect(await repo.transition(T2, docA.id, ['needs_review'], { status: 'posted' })).toBe(false);

    // Tenant 1 transitions its own document and finds it via findPostedByDedupeKey / findPostedBySha
    expect(await repo.transition(T1, docA.id, ['needs_review'], { status: 'posted' })).toBe(true);
    expect((await repo.findPostedByDedupeKey(T1, 'DEDUPE-A1'))?.id).toBe(docA.id);
    expect((await repo.findPostedBySha(T1, 'a'.repeat(64)))?.id).toBe(docA.id);
    expect(await repo.findPostedByDedupeKey(T2, 'DEDUPE-A1')).toBeNull();
    expect(await repo.findPostedBySha(T2, 'a'.repeat(64))).toBeNull();

    // Unscoped connection sees 0 rows across all 6 tables
    for (const table of CAPTURE_RLS_TABLES) {
      expect(await app.query(`SELECT count(*)::int AS n FROM "${table}"`)).toEqual([{ n: 0 }]);
    }
  });

  it('reverses and re-applies EnableRlsCapture1789900000800 cleanly', async () => {
    const runner = owner.createQueryRunner();
    const migration = new EnableRlsCapture1789900000800();
    try {
      await migration.down(runner);
      const off = await owner.query(
        `SELECT count(*)::int AS enabled FROM pg_class WHERE relname = ANY($1::text[]) AND (relrowsecurity OR relforcerowsecurity)`,
        [CAPTURE_RLS_TABLES],
      );
      expect(off).toEqual([{ enabled: 0 }]);

      await migration.up(runner);
      const on = await owner.query(
        `SELECT count(*)::int AS forced FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity`,
        [CAPTURE_RLS_TABLES],
      );
      expect(on).toEqual([{ forced: CAPTURE_RLS_TABLES.length }]);
    } finally {
      await runner.release();
    }
  });
});
