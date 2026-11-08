/**
 * Real PostgreSQL FORCE RLS test for CRM (`crm_leads`, `crm_activities`) (#475, #619).
 * Connects as a `NOSUPERUSER NOBYPASSRLS` application role and exercises the real
 * `CrmRepository` and `CrmActivityRepository` methods across two tenants.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  CRM_RLS_TABLES,
  EnableRlsCrm1789900000700,
} from '../../migrations/1789900000700-EnableRlsCrm';
import { TenantScope } from '../access/services/tenant-scope';
import { ContactMessageEntity } from './entities/contact-message.entity';
import { CrmActivityEntity } from './entities/crm-activity.entity';
import { CrmLeadEntity } from './entities/crm-lead.entity';
import { PipelineStage } from './enums/crm.enums';
import { CrmActivityRepository } from './repositories/crm-activity.repository';
import { CrmRepository } from './repositories/crm.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'crm-rls-app-test-only';
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

describePg('CRM FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS, real repository methods) (#619)', () => {
  const db = `rx_crm_rls_${process.pid}_${Date.now()}`;
  const role = `rx_crm_rls_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let crmRepo: CrmRepository;
  let activityRepo: CrmActivityRepository;

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
    crmRepo = new CrmRepository(
      app.getRepository(CrmLeadEntity),
      app.getRepository(ContactMessageEntity),
      scope,
    );
    activityRepo = new CrmActivityRepository(app.getRepository(CrmActivityEntity), scope);

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

  it('enables and forces RLS with policy on crm_leads and crm_activities', async () => {
    const rows = (await owner.query(
      `SELECT c.relname AS table_name,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
        WHERE c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [CRM_RLS_TABLES],
    )) as Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policies: number }>;

    expect(rows).toEqual([
      { table_name: 'crm_activities', rls_enabled: true, rls_forced: true, policies: 1 },
      { table_name: 'crm_leads', rls_enabled: true, rls_forced: true, policies: 1 },
    ]);
  });

  it('isolates CrmRepository lead methods across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const leadA = await crmRepo.createLead(T1, {
      fullName: 'مشتری الف',
      email: 'a@example.com',
      phone: '09121112233',
      company: 'شرکت الف',
      pipelineStage: PipelineStage.QUALIFIED,
      estimatedValue: 50_000_000,
    });
    const leadB = await crmRepo.createLead(T2, {
      fullName: 'مشتری ب',
      email: 'b@example.com',
      phone: '09124445566',
      company: 'شرکت ب',
      pipelineStage: PipelineStage.WON,
      estimatedValue: 90_000_000,
    });

    const walkInA = await crmRepo.createWalkInLead(T1, 'مشتری حضوری');
    expect((await crmRepo.findWalkInLead(T1))?.id).toBe(walkInA.id);
    expect(await crmRepo.findWalkInLead(T2)).toBeNull();

    // Tenant 1 reads its own lead by ID, email, phone, list, count, and stage aggregates
    expect((await crmRepo.findLeadById(T1, leadA.id))?.fullName).toBe('مشتری الف');
    expect((await crmRepo.findLeadByEmail(T1, 'a@example.com'))?.id).toBe(leadA.id);
    expect(await crmRepo.findLeadEmails(T1, ['a@example.com', 'b@example.com'])).toEqual(['a@example.com']);
    expect(await crmRepo.findLeadPhones(T1, ['09121112233', '09124445566'])).toEqual(['09121112233']);
    expect(await crmRepo.countAllLeads(T1)).toBe(1);
    expect((await crmRepo.findAllLeads(T1)).map((l) => l.id)).toEqual([leadA.id]);

    const [foundT1, totalT1] = await crmRepo.findLeadsAndCount(T1, {
      search: 'مشتری',
      skip: 0,
      take: 10,
    });
    expect(totalT1).toBe(1);
    expect(foundT1[0].id).toBe(leadA.id);

    const stagesT1 = await crmRepo.getStageAggregates(T1);
    expect(stagesT1).toEqual([
      {
        stage: PipelineStage.QUALIFIED,
        count: '1',
        value: '50000000.00',
      },
    ]);

    // Tenant 2 cannot read, update, or delete Tenant 1's lead
    expect(await crmRepo.findLeadById(T2, leadA.id)).toBeNull();
    expect(await crmRepo.findLeadByEmail(T2, 'a@example.com')).toBeNull();

    await crmRepo.saveLead(T2, { ...leadA, fullName: 'HACKED' });
    expect((await crmRepo.findLeadById(T1, leadA.id))?.fullName).toBe('مشتری الف');

    expect(await crmRepo.deleteLeadsByIds(T2, [leadA.id])).toBe(0);
    expect(await crmRepo.findLeadById(T1, leadA.id)).not.toBeNull();
    expect(leadB.id).not.toBe(leadA.id);

    // Unscoped connection sees 0 rows in crm_leads
    expect(await app.query(`SELECT count(*)::int AS n FROM crm_leads`)).toEqual([{ n: 0 }]);
  });

  it('isolates CrmActivityRepository across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const idsA = await activityRepo.createActivities(T1, [
      {
        partyCode: 'CUST-A1',
        channel: 'CALL',
        activityDate: '2026-05-10',
        notes: 'یادداشت الف',
      },
    ]);
    const idsB = await activityRepo.createActivities(T2, [
      {
        partyCode: 'CUST-B1',
        channel: 'MEETING',
        activityDate: '2026-05-11',
        notes: 'یادداشت ب',
      },
    ]);

    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);

    // Tenant 2 cannot delete Tenant 1's activity
    expect(await activityRepo.deleteByIds(T2, idsA)).toBe(0);

    // Tenant 1 can delete its own activity
    expect(await activityRepo.deleteByIds(T1, idsA)).toBe(1);

    // Unscoped connection sees 0 rows in crm_activities
    expect(await app.query(`SELECT count(*)::int AS n FROM crm_activities`)).toEqual([{ n: 0 }]);
  });

  it('reverses and re-applies EnableRlsCrm1789900000700 cleanly', async () => {
    const runner = owner.createQueryRunner();
    const migration = new EnableRlsCrm1789900000700();
    try {
      await migration.down(runner);
      const off = await owner.query(
        `SELECT count(*)::int AS enabled FROM pg_class WHERE relname = ANY($1::text[]) AND (relrowsecurity OR relforcerowsecurity)`,
        [CRM_RLS_TABLES],
      );
      expect(off).toEqual([{ enabled: 0 }]);

      await migration.up(runner);
      const on = await owner.query(
        `SELECT count(*)::int AS forced FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity`,
        [CRM_RLS_TABLES],
      );
      expect(on).toEqual([{ forced: CRM_RLS_TABLES.length }]);
    } finally {
      await runner.release();
    }
  });
});
