/**
 * Statutory electronic commercial books export (دفاتر تجاری الکترونیکی) on real PostgreSQL:
 *   - Official template column headers & order (A-I)
 *   - Account turnover grouped by kol + moein + tafsili + date
 *   - Balanced turnover: total debit = total credit
 *   - Tenant isolation under FORCE RLS
 *   - Runs under a real NOSUPERUSER NOBYPASSRLS PostgreSQL role through TenantScope
 *
 * ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/tax_compliance/electronic-books.pg.spec.ts --runInBand
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { strFromU8, unzipSync } from 'fflate';
import { TenantScope } from '../access/services/tenant-scope';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import {
  ELECTRONIC_BOOKS_LAYOUT_STATUS,
  OFFICIAL_ELECTRONIC_BOOKS_HEADERS,
} from './reports/electronic-books.constants';
import { LedgerExportRepository } from './reports/ledger-export.repository';
import { LedgerExportService } from './reports/ledger-export.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? (OWNER === 'mac' ? 'template1' : 'postgres');
const APP_PW = crypto.randomBytes(16).toString('hex');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

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

function extractSheet1Headers(buf: Buffer): string[] {
  const zip = unzipSync(new Uint8Array(buf));
  let sharedStrings: string[] = [];
  if (zip['xl/sharedStrings.xml']) {
    const sstXml = strFromU8(zip['xl/sharedStrings.xml']);
    sharedStrings = [...sstXml.matchAll(/<si><t[^>]*>([^<]+)<\/t><\/si>/g)].map((m) => m[1]);
  }
  const sheetXml = strFromU8(zip['xl/worksheets/sheet1.xml']);
  const row1 = sheetXml.match(/<row[^>]*r="1"[^>]*>(.*?)<\/row>/)![1];
  const cellTags = [...row1.matchAll(/<c\s+([^>]+)>(.*?)<\/c>/g)];
  return cellTags.map((m) => {
    const attrs = m[1];
    const body = m[2];
    const isShared = /t="s"/.test(attrs);
    const inlineMatch = body.match(/<t[^>]*>([^<]*)<\/t>/);
    if (inlineMatch && !isShared) return inlineMatch[1];
    const valMatch = body.match(/<v>(\d+)<\/v>/);
    if (isShared && valMatch) return sharedStrings[parseInt(valMatch[1], 10)];
    return valMatch ? valMatch[1] : '';
  });
}

describePg('T80: Statutory Electronic Commercial Books Export on PostgreSQL (NOSUPERUSER, NOBYPASSRLS)', () => {
  const db = `rx_ebooks_${process.pid}_${Date.now()}`;
  const role = `rx_ebooks_app_${process.pid}`;
  let admin: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;

  let tenantScope: TenantScope;
  let exportRepo: LedgerExportRepository;
  let exportService: LedgerExportService;
  let statutoryRepo: StatutoryRepository;

  beforeAll(async () => {
    admin = await new DataSource({ ...options(ADMIN_DB), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);

    ownerDs = await new DataSource(options(db)).initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);

    appDs = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    tenantScope = new TenantScope(appDs);

    exportRepo = new LedgerExportRepository(tenantScope);
    statutoryRepo = new StatutoryRepository(tenantScope);
    exportService = new LedgerExportService(exportRepo, statutoryRepo);

    // 1. Seed Chart of Accounts for Tenant A & Tenant B
    await ownerDs.query(`
      INSERT INTO "fin_chart_of_accounts" ("id", "tenant_id", "code", "name", "account_type", "level", "parent_code")
      VALUES
        (5001, '${TENANT_A}', '10', 'دارایی‌های جاری', 'ASSET', 'KOL', NULL),
        (5002, '${TENANT_A}', '1010', 'موجودی نقد و بانک', 'ASSET', 'MOEIN', '10'),
        (5003, '${TENANT_A}', '40', 'درآمدها', 'REVENUE', 'KOL', NULL),
        (5004, '${TENANT_A}', '4010', 'درآمد فروش کالا', 'REVENUE', 'MOEIN', '40'),
        (5005, '${TENANT_B}', '10', 'دارایی‌های جاری B', 'ASSET', 'KOL', NULL),
        (5006, '${TENANT_B}', '1010', 'صندوق B', 'ASSET', 'MOEIN', '10')
      ON CONFLICT DO NOTHING
    `);

    // 2. Seed Floating Detail (fin_dimensions) for Tenant A
    await ownerDs.query(`
      INSERT INTO "fin_dimensions" ("id", "tenant_id", "kind", "code", "name", "active")
      VALUES
        (6001, '${TENANT_A}', 'DETAIL', 'TF-CENTRAL', 'شعبه مرکزی', true)
      ON CONFLICT DO NOTHING
    `);

    // 3. Seed Posted Journal Entries for Tenant A
    await ownerDs.query(`
      INSERT INTO "fin_journal_entries" ("id", "tenant_id", "entry_number", "permanent_number", "date", "description", "status")
      VALUES
        (7001, '${TENANT_A}', 'JV-801', '1', '2026-04-15', 'فروش نقدی فروردین', 'POSTED'),
        (7002, '${TENANT_A}', 'JV-802', '2', '2026-04-15', 'فروش اعتباری فروردین', 'POSTED'),
        (7003, '${TENANT_B}', 'JV-B01', '1', '2026-04-15', 'سند مستأجر دیگر', 'POSTED')
      ON CONFLICT DO NOTHING
    `);

    // 4. Lines: Balanced double entries
    await ownerDs.query(`
      INSERT INTO "fin_journal_entry_lines" ("id", "tenant_id", "journal_entry_id", "account_id", "detail_id", "debit", "credit", "description")
      VALUES
        (8001, '${TENANT_A}', 7001, 5002, 6001, 25000000.00, 0, 'دریافت نقد شعبه مرکزی'),
        (8002, '${TENANT_A}', 7001, 5004, NULL, 0, 25000000.00, 'فروش کالای الف'),
        (8003, '${TENANT_A}', 7002, 5002, NULL, 15000000.00, 0, 'دریافت دوم'),
        (8004, '${TENANT_A}', 7002, 5004, NULL, 0, 15000000.00, 'فروش کالای ب'),
        (8005, '${TENANT_B}', 7003, 5006, NULL, 99000000.00, 99000000.00, 'تراکنش تننت ب')
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy();
    }
  });

  it('queries account turnover under Tenant A without leaking Tenant B data', async () => {
    const turnover = await exportRepo.accountTurnover(TENANT_A, '2026-03-21', '2026-06-22');
    expect(turnover.length).toBeGreaterThan(0);

    // Verify Tenant B's data is never included
    const hasTenantB = turnover.some((t) => t.kolName.includes('B') || t.moeinName.includes('B'));
    expect(hasTenantB).toBe(false);

    // Verify detail resolution
    const withDetail = turnover.find((t) => t.tafsiliCode === 'TF-CENTRAL');
    expect(withDetail).toBeDefined();
    expect(withDetail?.tafsiliName).toBe('شعبه مرکزی');
    expect(withDetail?.kolCode).toBe('10');
    expect(withDetail?.moeinCode).toBe('1010');
  });

  it('exports XLSX matching official tax template header row exactly', async () => {
    const templatePath = path.resolve(
      __dirname,
      '../../../../docs/tax/official/electronic-books-template.xlsx',
    );
    const templateBuf = fs.readFileSync(templatePath);
    const templateHeaders = extractSheet1Headers(templateBuf);

    const xlsxBuffer = await exportService.electronicBooksXlsx(TENANT_A, {
      year: 1405,
      quarter: 1,
    });
    const exportedHeaders = extractSheet1Headers(xlsxBuffer);

    expect(exportedHeaders).toEqual(templateHeaders);
    expect(exportedHeaders).toEqual([...OFFICIAL_ELECTRONIC_BOOKS_HEADERS]);
  });

  it('calculates balanced debit and credit totals in million rials', async () => {
    const { rows, totalDebitMinor, totalCreditMinor } = await exportService.getTurnoverData(
      TENANT_A,
      { year: 1405, quarter: 1 },
    );

    expect(totalDebitMinor).toBe(totalCreditMinor);
    expect(totalDebitMinor).toBe(40_000_000_00n); // 40,000,000 rials in minor units = 40 million rials

    // Check million rials formatted rows
    const sumDebitMillion = rows.reduce((acc, r) => acc + Number(r[6]), 0);
    const sumCreditMillion = rows.reduce((acc, r) => acc + Number(r[7]), 0);
    expect(sumDebitMillion).toBe(40);
    expect(sumCreditMillion).toBe(40);
  });

  it('verifies FORCE RLS (relforcerowsecurity = true) on queried fin_* and statutory tables', async () => {
    const rlsRows: Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }> =
      await ownerDs.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class
         WHERE relname IN (
           'fin_chart_of_accounts',
           'fin_dimensions',
           'fin_journal_entries',
           'fin_journal_entry_lines'
         )
         ORDER BY relname
      `);
    expect(rlsRows).toHaveLength(4);
    for (const row of rlsRows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });
});
