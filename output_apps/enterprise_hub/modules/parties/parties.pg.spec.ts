/**
 * Parties on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS, the repository
 * (including the importer's upsert-by-code) and tenant isolation end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/parties/parties.pg.spec.ts
 */
import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartyRole } from './enums/party-role.enum';
import { PartiesRepository } from './repositories/parties.repository';
import { PartiesService } from './services/parties.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'parties-app-test-only';
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

describePg('Parties on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_parties_${process.pid}_${Date.now()}`;
  const role = `rx_prt_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let repository: PartiesRepository;
  let service: PartiesService;

  const dto = (over: Record<string, unknown>) =>
    ({
      code: 'C1',
      name: 'مشتری ۱',
      role: PartyRole.CUSTOMER,
      ...over,
    }) as never;

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
    repository = new PartiesRepository(scope);
    service = new PartiesService(repository);
    for (const tenantId of [T1, T2]) {
      await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)]).catch(() => undefined);
    }
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('runs as a non-superuser without BYPASSRLS and erp_parties has ENABLE + FORCE RLS with a policy', async () => {
    const [r] = await app.query(`SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`);
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    const [row] = await owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = 'erp_parties'`,
    );
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  it('creates a party and reads it back by code, with trimmed code and name', async () => {
    const created = await service.create(T1, dto({ code: ' C100 ', name: ' فروشگاه الف ' }));
    expect(created.code).toBe('C100');
    expect(created.name).toBe('فروشگاه الف');
    expect(created.active).toBe(true);
    expect((await service.getByCode(T1, 'C100')).id).toBe(created.id);
  });

  it('the same code is allowed in two tenants, but a duplicate within one tenant is refused', async () => {
    await service.create(T1, dto({ code: 'SHARED', name: 'اولی' }));
    await service.create(T2, dto({ code: 'SHARED', name: 'پیمانکار' }));
    await expect(service.create(T1, dto({ code: 'SHARED', name: 'تکراری' }))).rejects.toBeInstanceOf(ConflictException);
    expect((await service.getByCode(T2, 'SHARED')).name).toBe('پیمانکار');
    expect((await service.getByCode(T1, 'SHARED')).name).toBe('اولی');
  });

  it('tenant B cannot see, update or delete tenant A party through the app role', async () => {
    const mine = await service.create(T1, dto({ code: 'HIDDEN', name: 'مخفی' }));
    await expect(service.getByCode(T2, 'HIDDEN')).rejects.toThrow('یافت نشد');
    await expect(service.update(T2, mine.id, { name: 'x' } as never)).rejects.toThrow('یافت نشد');
    expect(await repository.deleteByIds(T2, [mine.id])).toBe(0);
    expect(await repository.findById(T2, mine.id)).toBeNull();
  });

  it('even a query with no tenant filter is cut off by RLS, and no scope means no rows', () =>
    app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      const seen = await m.query(`SELECT DISTINCT tenant_id FROM erp_parties`);
      expect(seen.map((r: { tenant_id: string }) => r.tenant_id)).toEqual([T2]);
      expect(await app.query(`SELECT 1 FROM erp_parties`)).toEqual([]);
    }));

  it('a write for the wrong tenant is rejected by the policy WITH CHECK', async () => {
    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, T2);
        await m.query(`INSERT INTO erp_parties (tenant_id, code, name, role) VALUES ($1, 'X1', 'x', 'customer')`, [T1]);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('insertMany upserts by code: the second call updates the name and reports inserted=false', async () => {
    const first = await service.upsertMany(T1, [
      { code: 'SUP1', name: 'تامین‌کننده یک', role: PartyRole.SUPPLIER, nationalId: null, economicCode: null, phone: null, email: null },
    ]);
    expect(first).toEqual([{ code: 'SUP1', id: expect.any(Number), inserted: true }]);
    const second = await service.upsertMany(T1, [
      { code: 'SUP1', name: 'تامین‌کننده اصلاح‌شده', role: PartyRole.SUPPLIER, nationalId: null, economicCode: null, phone: null, email: null },
      { code: 'SUP2', name: 'تامین‌کننده دو', role: PartyRole.BOTH, nationalId: null, economicCode: null, phone: null, email: null },
    ]);
    expect(second.map((r) => [r.code, r.inserted])).toEqual([['SUP1', false], ['SUP2', true]]);
    expect((await service.getByCode(T1, 'SUP1')).name).toBe('تامین‌کننده اصلاح‌شده');
    expect(await service.findExistingCodes(T1, ['SUP1', 'NOPE'])).toEqual(['SUP1']);
    expect(await service.findExistingCodes(T1, [])).toEqual([]);
  });

  it('list role filter returns customer and both, not supplier; search escapes ILIKE wildcards', async () => {
    await service.upsertMany(T1, [
      { code: 'F1', name: 'مشتری معمولی', role: PartyRole.CUSTOMER, nationalId: null, economicCode: null, phone: null, email: null },
      { code: 'F2', name: 'هر دو نقش', role: PartyRole.BOTH, nationalId: null, economicCode: null, phone: null, email: null },
      { code: 'F3', name: 'فقط تامین', role: PartyRole.SUPPLIER, nationalId: null, economicCode: null, phone: null, email: null },
      { code: 'F4', name: 'الف٪ویژه', role: PartyRole.CUSTOMER, nationalId: null, economicCode: null, phone: null, email: null },
    ]);
    // T1 now holds: C100, HIDDEN, SHARED, F1, F4 (customers), F2 and SUP2 (both), F3 and SUP1 (suppliers)
    const customers = await service.list(T1, { role: PartyRole.CUSTOMER, limit: 200, offset: 0 } as never);
    expect(customers.data.map((p) => p.code)).toEqual(['C100', 'F1', 'F2', 'F4', 'HIDDEN', 'SHARED', 'SUP2']);
    // 'both' answers both filters
    const suppliers = await service.list(T1, { role: PartyRole.SUPPLIER, limit: 200, offset: 0 } as never);
    expect(suppliers.data.map((p) => p.code)).toEqual(['F2', 'F3', 'SUP1', 'SUP2']);
    // the percent in the search term is escaped, so it matches the literal character only
    const escaped = await service.list(T1, { search: 'الف%', limit: 200, offset: 0 } as never);
    expect(escaped.data.map((p) => p.code)).toEqual([]);
    const plain = await service.list(T1, { search: 'الف', limit: 200, offset: 0 } as never);
    expect(plain.data.map((p) => p.code)).toEqual(['C100', 'F4']); // C100 is «فروشگاه الف»
  });

  it('deactivates instead of deleting, and deleteByIds removes exactly the importer rows', async () => {
    const party = await service.create(T1, dto({ code: 'DEAD', name: 'غیرفعال می‌شود' }));
    const updated = await service.update(T1, party.id, { active: false } as never);
    expect(updated.active).toBe(false);
    const importerRows = await service.upsertMany(T1, [
      { code: 'TMP1', name: 'دانی', role: PartyRole.CUSTOMER, nationalId: null, economicCode: null, phone: null, email: null },
    ]);
    expect(await service.removeByIds(T1, importerRows.map((r) => r.id))).toBe(1);
    expect(await repository.findById(T1, importerRows[0].id)).toBeNull();
    expect(await service.getByCode(T1, 'DEAD')).toMatchObject({ active: false });
  });
});
