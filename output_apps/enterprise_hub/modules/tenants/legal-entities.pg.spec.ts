/**
 * T224 on PostgreSQL (non-superuser, FORCE RLS): verifies `legal_entities` RLS, backfill from
 * `tenants` / `tenant_onboarding_progress`, and UAE VAT group TIN refusal.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { TenantScope } from '../access/services/tenant-scope';
import { CreateLegalEntitiesAndTaxIds1789900012100 } from '../../migrations/1789900012100-CreateLegalEntitiesAndTaxIds';
import { APP_USER, createTestDatabase, describePg, TestDatabaseContext, TEST_T1 as T1, TEST_T2 as T2 } from '../../test/support/test-pg';
import { LegalEntitiesRepository } from './repositories/legal-entities.repository';
import { LegalEntitiesService } from './services/legal-entities.service';

describePg('LegalEntities on PostgreSQL (FORCE RLS + backfill)', () => {
  let testDb: TestDatabaseContext;
  let service: LegalEntitiesService;

  beforeAll(async () => {
    testDb = await createTestDatabase('legal_entities');
    await testDb.owner.query(
      `INSERT INTO tenants (id, name, slug, country_code)
       VALUES ($1, 'Tenant One', 't1-legal', 'IR'), ($2, 'Tenant Two', 't2-legal', 'AE')
       ON CONFLICT (id) DO NOTHING`,
      [T1, T2],
    );
    await testDb.owner.query(
      `INSERT INTO tenant_onboarding_progress (tenant_id, economic_code)
       VALUES ($1, '411111111111')
       ON CONFLICT (tenant_id) DO NOTHING`,
      [T1],
    );
    const qr = testDb.owner.createQueryRunner();
    try {
      const migration = new CreateLegalEntitiesAndTaxIds1789900012100();
      await migration.down(qr);
      await migration.up(qr);
    } finally {
      await qr.release();
    }
    await testDb.owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE legal_entities TO ${APP_USER}`);
    service = new LegalEntitiesService(new LegalEntitiesRepository(new TenantScope(testDb.app)));
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('legal_entities has ENABLE + FORCE RLS with a policy and backfills DEFAULT entity per tenant', async () => {
    const [rls] = await testDb.owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = 'legal_entities'`,
    );
    expect(rls).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });

    const list1 = await service.list(T1);
    const list2 = await service.list(T2);
    const def1 = list1.find((e) => e.code === 'DEFAULT' && e.isDefault);
    expect(def1).toBeDefined();
    expect(def1?.taxId).toBe('411111111111');
    expect(list2.some((e) => e.code === 'DEFAULT' && e.isDefault)).toBe(true);
    expect(list1.every((e) => e.tenantId === T1)).toBe(true);
  });

  it('stores member TIN on UAE legal entity and refuses UAE VAT group TIN for e-invoicing', async () => {
    const entity = await service.upsert(T1, {
      code: 'AE-SUB',
      name: 'Dubai Member LLC',
      countryCode: 'AE',
      taxId: '1001112223',
      vatId: '100111222300003',
      einvoiceId: '1001112223',
      vatGroupTin: '1009998887',
    });
    await expect(service.resolveForEInvoicing(T1, entity.id, '1009998887')).rejects.toBeInstanceOf(BadRequestException);
    const resolved = await service.resolveForEInvoicing(T1, entity.id);
    expect(resolved.einvoiceId).toBe('1001112223');
    // Tenant 2 cannot see Tenant 1's entity
    expect((await service.list(T2)).some((e) => e.id === entity.id)).toBe(false);
  });
});
