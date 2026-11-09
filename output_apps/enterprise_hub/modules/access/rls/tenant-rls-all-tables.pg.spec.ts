/**
 * Complete tenant RLS audit and Invoicing + Tax Compliance isolation proof (#475, #617):
 *   1. Lists EVERY table in `public` that has a `tenant_id` column and fails if ANY table
 *      outside the explicit `RLS_PENDING_ALLOWLIST` lacks `ENABLE + FORCE ROW LEVEL SECURITY`
 *      or a policy.
 *   2. Connects as a non-superuser role (`NOSUPERUSER NOBYPASSRLS`) and exercises the REAL
 *      repository methods of `InvoicingRepository`, `MoadianRepository`, `TaxComplianceRepository`,
 *      and `SeasonalReportRepository` to prove Tenant A reads/writes its own rows while Tenant B
 *      cannot read, update, or delete Tenant A's rows.
 *   3. Verifies that `EnableRlsRemainingTenantTables1789900000600` `down()` and `up()` are reversible.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/access/rls/tenant-rls-all-tables.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  EnableRlsRemainingTenantTables1789900000600,
  INVOICING_AND_TAX_RLS_TABLES,
} from '../../../migrations/1789900000600-EnableRlsRemainingTenantTables';
import { CaptureDocumentEntity } from '../../invoice_capture/entities/capture.entities';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceDirection, InvoiceSubject } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { MoadianCredentialEntity } from '../../tax_compliance/entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from '../../tax_compliance/entities/moadian-submission.entity';
import { TaxInvoiceSignatureEntity } from '../../tax_compliance/entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from '../../tax_compliance/entities/tax-signing-key.entity';
import { MoadianSubmissionStatus } from '../../tax_compliance/enums/moadian.enum';
import { TaxSubmissionStatus } from '../../tax_compliance/enums/tax-compliance.enum';
import { SeasonalReportRepository } from '../../tax_compliance/reports/seasonal-report.repository';
import { MoadianRepository } from '../../tax_compliance/repositories/moadian.repository';
import { TaxComplianceRepository } from '../../tax_compliance/repositories/tax-compliance.repository';
import { TenantScope } from '../services/tenant-scope';

/**
 * Explicit allow-list of public tables with `tenant_id` that do not yet have
 * `ENABLE + FORCE ROW LEVEL SECURITY`:
 * - 8 pre-tenant auth/membership/entitlement & public-form tables (need dedicated design, see #475)
 * - 29 module tables scheduled for the next per-module RLS PRs (CRM, Capture, Banking, Data Import, Inventory)
 *
 * Any newly added table with `tenant_id` outside this list will immediately fail the audit spec unless
 * its migration enables FORCE RLS.
 */
export const RLS_PENDING_ALLOWLIST = new Set<string>([
  // Module 2: CRM
  'crm_activities',
  'crm_leads',
  // Module 3: Invoice Capture
  'capture_audit',
  'capture_documents',
  'capture_files',
  'capture_settings',
  'capture_vendor_rules',
  'capture_vendors',
  // Module 4: Bank Reconciliation & Bank Accounts
  'fin_bank_accounts',
  'fin_bank_recon_attachments',
  'fin_bank_recon_audit',
  'fin_bank_recon_drafts',
  'fin_bank_recon_items',
  'fin_bank_recon_matches',
  'fin_bank_recon_reports',
  'fin_bank_recon_rules',
  'fin_bank_recon_sessions',
  'fin_bank_recon_settings',
  'fin_bank_statement_lines',
  // Module 5: Data Import & Damages
  'damage_calculations',
  'data_import_batch_items',
  'data_import_batches',
  'data_import_mapping_memory',
  // Module 6: Inventory / ERP Stock
  'erp_stock_document_lines',
  'erp_stock_documents',
  'erp_stock_items',
  'erp_stores',
  'erp_warehouses',
  'inventory_fifo_batches',
]);

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'rls-all-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('All tenant tables FORCE RLS audit and Invoicing/Tax isolation on PostgreSQL (#475)', () => {
  const db = `rx_rls_all_${process.pid}_${Date.now()}`;
  const role = `rx_rls_all_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let invoicingRepo: InvoicingRepository;
  let moadianRepo: MoadianRepository;
  let taxRepo: TaxComplianceRepository;
  let seasonalRepo: SeasonalReportRepository;

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

    invoicingRepo = new InvoicingRepository(app.getRepository(InvoiceEntity), app, scope);
    moadianRepo = new MoadianRepository(
      app.getRepository(MoadianCredentialEntity),
      app.getRepository(MoadianSubmissionEntity),
      scope,
    );
    taxRepo = new TaxComplianceRepository(
      app.getRepository(TaxSigningKeyEntity),
      app.getRepository(TaxInvoiceSignatureEntity),
      scope,
    );
    seasonalRepo = new SeasonalReportRepository(
      app.getRepository(InvoiceEntity),
      app.getRepository(CaptureDocumentEntity),
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

  it('connects as a non-superuser without BYPASSRLS', async () => {
    const [r] = await app.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(r).toMatchObject({ u: role, rolsuper: false, rolbypassrls: false });
  });

  it('lists every table in public with a tenant_id column and fails if any table outside RLS_PENDING_ALLOWLIST lacks ENABLE + FORCE RLS', async () => {
    const rows = (await owner.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind = 'r'
       ORDER BY c.relname
    `)) as Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policies: number }>;

    expect(rows.length).toBeGreaterThanOrEqual(101);
    const missing = rows
      .filter((r) => !RLS_PENDING_ALLOWLIST.has(r.table_name))
      .filter((r) => !r.rls_enabled || !r.rls_forced || r.policies < 1);
    expect(missing).toEqual([]);
  });

  it('verifies each of the 5 tables in INVOICING_AND_TAX_RLS_TABLES has policy <table_name>_tenant with USING and WITH CHECK', async () => {
    const rows = (await owner.query(
      `SELECT c.relname AS table_name,
              p.polname AS policy_name,
              pg_get_expr(p.polqual, p.polrelid) AS using_expr,
              pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
         FROM pg_class c
         JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = ANY($1::text[]) AND p.polname = c.relname || '_tenant'`,
      [INVOICING_AND_TAX_RLS_TABLES],
    )) as Array<{ table_name: string; policy_name: string; using_expr: string; check_expr: string }>;

    expect(rows).toHaveLength(INVOICING_AND_TAX_RLS_TABLES.length);
    for (const row of rows) {
      expect(row.using_expr).toContain('app.tenant_id');
      expect(row.check_expr).toContain('app.tenant_id');
    }
  });

  describe('real repository isolation under NOSUPERUSER NOBYPASSRLS', () => {
    it('isolates InvoicingRepository and SeasonalReportRepository across tenants', async () => {
      const issuedAt = new Date('2026-05-10T10:00:00+03:30');
      const invA = await invoicingRepo.create(T1, {
        taxInvoiceNumber: 'INV-RLS-A1',
        sellerInfo: { name: 'فروشنده الف' } as InvoiceEntity['sellerInfo'],
        buyerInfo: { name: 'خریدار الف' } as InvoiceEntity['buyerInfo'],
        items: [],
        currency: 'IRR' as InvoiceEntity['currency'],
        jurisdiction: InvoiceJurisdiction.IR,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.ISSUED,
        totalAmount: 1_000_000,
        totalDiscount: 0,
        totalTax: 100_000,
        finalPayable: 1_100_000,
        issuedAt,
        idempotencyKey: 'KEY-A1',
      });

      const invB = await invoicingRepo.create(T2, {
        taxInvoiceNumber: 'INV-RLS-B1',
        sellerInfo: { name: 'فروشنده ب' } as InvoiceEntity['sellerInfo'],
        buyerInfo: { name: 'خریدار ب' } as InvoiceEntity['buyerInfo'],
        items: [],
        currency: 'IRR' as InvoiceEntity['currency'],
        jurisdiction: InvoiceJurisdiction.IR,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.ISSUED,
        totalAmount: 2_000_000,
        totalDiscount: 0,
        totalTax: 200_000,
        finalPayable: 2_200_000,
        issuedAt,
        idempotencyKey: 'KEY-B1',
      });

      // Tenant 1 reads its own invoice through every repository query path
      expect((await invoicingRepo.findById(T1, invA.id))?.taxInvoiceNumber).toBe('INV-RLS-A1');
      expect((await invoicingRepo.findByIdempotencyKey(T1, 'KEY-A1'))?.id).toBe(invA.id);
      expect((await invoicingRepo.findByTaxInvoiceNumber(T1, 'INV-RLS-A1'))?.id).toBe(invA.id);

      // Tenant 2 cannot see Tenant 1's invoice
      expect(await invoicingRepo.findById(T2, invA.id)).toBeNull();
      expect(await invoicingRepo.findByIdempotencyKey(T2, 'KEY-A1')).toBeNull();
      expect(await invoicingRepo.findByTaxInvoiceNumber(T2, 'INV-RLS-A1')).toBeNull();

      // List, search, summarize, and seasonal report queries return only the active tenant's rows
      const [listT1, countT1] = await invoicingRepo.findAndCount(T1, {});
      expect(countT1).toBe(1);
      expect(listT1[0].id).toBe(invA.id);

      const [searchT2, searchCountT2] = await invoicingRepo.searchAndCount(T2, {
        search: 'INV-RLS',
        skip: 0,
        take: 10,
      });
      expect(searchCountT2).toBe(1);
      expect(searchT2[0].id).toBe(invB.id);

      const summaryT1 = await invoicingRepo.summarize(T1, {
        statuses: [InvoiceStatus.ISSUED],
      });
      expect(summaryT1).toEqual([
        {
          currency: 'IRR' as InvoiceEntity['currency'],
          status: InvoiceStatus.ISSUED,
          count: 1,
          total: 1_100_000,
          tax: 100_000,
        },
      ]);

      const salesBetweenT1 = await invoicingRepo.findSalesBetween(T1, '2026-05-01', '2026-05-31');
      expect(salesBetweenT1.map((i) => i.id)).toEqual([invA.id]);

      const seasonalT1 = await seasonalRepo.findIssuedBetween(
        T1,
        new Date('2026-05-01T00:00:00+03:30'),
        new Date('2026-06-01T00:00:00+03:30'),
      );
      expect(seasonalT1.map((i) => i.id)).toEqual([invA.id]);

      // Tenant 2 cannot mutate or delete Tenant 1's invoice via repository methods
      await invoicingRepo.updatePosting(T2, invA.id, { postingError: 'CROSS-TENANT' });
      expect((await invoicingRepo.findById(T1, invA.id))?.postingError).toBeNull();

      await invoicingRepo.save(T2, { ...invA, taxInvoiceNumber: 'HACKED' });
      expect((await invoicingRepo.findById(T1, invA.id))?.taxInvoiceNumber).toBe('INV-RLS-A1');

      expect(await invoicingRepo.deleteByIds(T2, [invA.id])).toBe(0);
      expect(await invoicingRepo.findById(T1, invA.id)).not.toBeNull();

      // Transaction lock methods bind the transaction to the tenant
      await invoicingRepo.transaction(async (manager) => {
        const locked = await invoicingRepo.findByIdForPosting(T1, invA.id, manager);
        expect(locked?.id).toBe(invA.id);
        const crossLocked = await invoicingRepo.findByIdForPosting(T2, invA.id, manager);
        expect(crossLocked).toBeNull();
      }, T1);

      // Unscoped connection sees 0 rows in invoices
      expect(await app.query(`SELECT count(*)::int AS n FROM invoices`)).toEqual([{ n: 0 }]);
    });

    it('isolates MoadianRepository credentials and submissions across tenants', async () => {
      const credA = await moadianRepo.upsertCredential(T1, {
        memoryId: 'A11122',
        economicCode: '10101010101',
        certificatePem: '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
        privateKeySealed: 'sealed-key-a',
        keyFingerprint: 'fp-a',
      });
      const credB = await moadianRepo.upsertCredential(T2, {
        memoryId: 'B33344',
        economicCode: '20202020202',
        certificatePem: '-----BEGIN CERTIFICATE-----\nB\n-----END CERTIFICATE-----',
        privateKeySealed: 'sealed-key-b',
        keyFingerprint: 'fp-b',
      });

      expect((await moadianRepo.findCredential(T1))?.memoryId).toBe('A11122');
      expect((await moadianRepo.findCredentialWithPrivateKey(T1))?.privateKeySealed).toBe('sealed-key-a');
      expect((await moadianRepo.findCredential(T2))?.memoryId).toBe('B33344');
      expect(credA.id).not.toBe(credB.id);

      // Atomic serial reservation increments only the active tenant's credential
      expect(await moadianRepo.reserveSerial(T1)).toBe(1);
      expect(await moadianRepo.reserveSerial(T1)).toBe(2);
      expect(await moadianRepo.reserveSerial(T2)).toBe(1);

      const [invA] = await invoicingRepo.findSalesBetween(T1);
      const subA = await moadianRepo.createSubmission(T1, {
        invoiceId: invA.id,
        uid: '33333333-3333-4333-8333-333333333333',
        taxId: 'A1112205A0000000000015',
        serial: '1',
        status: MoadianSubmissionStatus.QUEUED,
        packet: { total: 1_100_000 },
      });

      expect((await moadianRepo.findSubmissionById(T1, subA.id))?.taxId).toBe('A1112205A0000000000015');
      expect((await moadianRepo.findSubmissionByInvoice(T1, invA.id))?.id).toBe(subA.id);

      // Tenant 2 cannot read or update Tenant 1's submission
      expect(await moadianRepo.findSubmissionById(T2, subA.id)).toBeNull();
      expect(await moadianRepo.findSubmissionByInvoice(T2, invA.id)).toBeNull();
      expect(
        await moadianRepo.updateSubmission(T2, subA.id, {
          status: MoadianSubmissionStatus.SUCCESS,
        }),
      ).toBeNull();
      expect((await moadianRepo.findSubmissionById(T1, subA.id))?.status).toBe(
        MoadianSubmissionStatus.QUEUED,
      );

      // Unscoped connection sees 0 rows in moadian_credentials and moadian_submissions
      expect(await app.query(`SELECT count(*)::int AS n FROM moadian_credentials`)).toEqual([{ n: 0 }]);
      expect(await app.query(`SELECT count(*)::int AS n FROM moadian_submissions`)).toEqual([{ n: 0 }]);
    });

    it('isolates TaxComplianceRepository signing keys and signatures across tenants', async () => {
      const keyA = await taxRepo.createKey(T1, {
        keyId: 'KEY-ID-A1',
        publicKeyPem: 'fake-public-key-a',
        privateKeyPem: 'fake-private-key-a',
        keyFingerprint: 'a'.repeat(64),
        isActive: true,
      });
      await taxRepo.createKey(T2, {
        keyId: 'KEY-ID-B1',
        publicKeyPem: 'fake-public-key-b',
        privateKeyPem: 'fake-private-key-b',
        keyFingerprint: 'b'.repeat(64),
        isActive: true,
      });

      expect((await taxRepo.findActiveKey(T1))?.keyId).toBe('KEY-ID-A1');
      expect((await taxRepo.findActiveKeyWithPrivate(T1))?.privateKeyPem).toBe('fake-private-key-a');
      expect(await taxRepo.findKeyById(T2, 'KEY-ID-A1')).toBeNull();

      // Deactivating keys in Tenant 2 leaves Tenant 1's active key untouched
      await taxRepo.deactivateAllKeys(T2);
      expect((await taxRepo.findActiveKey(T1))?.isActive).toBe(true);
      expect(await taxRepo.findActiveKey(T2)).toBeNull();

      const [invA] = await invoicingRepo.findSalesBetween(T1);
      const sigA = await taxRepo.createSignature(T1, {
        invoiceId: invA.id,
        taxInvoiceNumber: invA.taxInvoiceNumber,
        taxId: 'A1112205A0000000000015',
        hashAlgorithm: 'SHA-256',
        dataHash: 'c'.repeat(64),
        signatureAlgorithm: 'RS256',
        jwsSignature: 'header.payload.sig',
        keyId: 'KEY-ID-A1',
        keyFingerprint: 'a'.repeat(64),
        status: TaxSubmissionStatus.SIGNED,
        signedPacket: { test: 1 },
      });

      expect((await taxRepo.findSignatureById(T1, sigA.id))?.taxId).toBe('A1112205A0000000000015');
      expect((await taxRepo.findSignatureByInvoiceId(T1, invA.id))?.id).toBe(sigA.id);
      expect(await taxRepo.findSignatureById(T2, sigA.id)).toBeNull();
      expect(await taxRepo.findSignatureByInvoiceId(T2, invA.id)).toBeNull();

      const [, sigCountT2] = await taxRepo.findSignaturesAndCount(T2, {});
      expect(sigCountT2).toBe(0);

      // Tenant 2 cannot overwrite Tenant 1's key or signature
      await taxRepo.saveKey(T2, { ...keyA, isActive: false });
      expect((await taxRepo.findActiveKey(T1))?.isActive).toBe(true);

      await taxRepo.saveSignature(T2, { ...sigA, status: TaxSubmissionStatus.REJECTED });
      expect((await taxRepo.findSignatureById(T1, sigA.id))?.status).toBe(TaxSubmissionStatus.SIGNED);

      // Tenant 2 cannot forge Tenant 1's tenant_id via raw SQL inside Tenant 2's scope
      await expect(
        scope.run(T2, (m) =>
          m.query(
            `INSERT INTO tax_signing_keys (tenant_id, key_id, public_key_pem, private_key_pem, key_fingerprint)
             VALUES ($1, 'FORGED', 'pub', 'priv', $2)`,
            [T1, 'f'.repeat(64)],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      // Unscoped connection sees 0 rows in tax_signing_keys and tax_invoice_signatures
      expect(await app.query(`SELECT count(*)::int AS n FROM tax_signing_keys`)).toEqual([{ n: 0 }]);
      expect(await app.query(`SELECT count(*)::int AS n FROM tax_invoice_signatures`)).toEqual([{ n: 0 }]);
    });
  });

  describe('migration reversibility', () => {
    it('down() disables RLS on the 5 invoicing/tax tables and up() restores FORCE RLS', async () => {
      const runner = owner.createQueryRunner();
      const migration = new EnableRlsRemainingTenantTables1789900000600();
      try {
        await migration.down(runner);
        const off = await owner.query(
          `SELECT count(*)::int AS enabled FROM pg_class WHERE relname = ANY($1::text[]) AND (relrowsecurity OR relforcerowsecurity)`,
          [INVOICING_AND_TAX_RLS_TABLES],
        );
        expect(off).toEqual([{ enabled: 0 }]);

        await migration.up(runner);
        const on = await owner.query(
          `SELECT count(*)::int AS forced FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity`,
          [INVOICING_AND_TAX_RLS_TABLES],
        );
        expect(on).toEqual([{ forced: INVOICING_AND_TAX_RLS_TABLES.length }]);
      } finally {
        await runner.release();
      }
    });
  });
});
