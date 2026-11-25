/**
 * Real PostgreSQL spec for `CountryPackInterceptor` + `CountryPackResolver` + `TenantsRepository`
 * running as `roxira_app` (`NOSUPERUSER NOBYPASSRLS`) with `TenantScope`.
 *
 * Opt-in like other pg specs: skipped unless `ROXIRA_TEST_PG_HOST` is set.
 */
import 'reflect-metadata';
import { CanActivate, Controller, ExecutionContext, Get, Injectable, Req } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createTestDatabase, describePg, TestDatabaseContext, TEST_T1 as T1, TEST_T2 as T2 } from '../../test/support/test-pg';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CountryPackCls, RequestWithCountryPack } from './country-pack.context';
import { CountryPackInterceptor } from './country-pack.interceptor';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPackResolver } from './country-pack.resolver';
import { createIranPack } from './ir/ir.pack';
import { createMalaysiaPack } from './my/my.pack';

@Injectable()
class HeaderTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const tid = req.headers['x-test-tenant'];
    if (tid) {
      req.user = { tenantId: String(tid) };
    }
    return true;
  }
}

@Controller('pg-test-pack')
class PgTestPackController {
  @Get()
  getPack(@Req() req: RequestWithCountryPack) {
    const clsPack = CountryPackCls.current();
    return {
      reqCountry: req.countryPack?.country ?? null,
      clsCountry: clsPack?.country ?? null,
      currency: clsPack?.locale.currency.code ?? null,
    };
  }
}

describePg('CountryPackInterceptor on PostgreSQL (roxira_app + TenantScope)', () => {
  let testDb: TestDatabaseContext;

  beforeAll(async () => {
    testDb = await createTestDatabase('country_pack_interceptor');
    await testDb.owner.query(
      `INSERT INTO tenants (id, name, slug, country_code, book_currency_code)
       VALUES ($1, 'Default Pack Tenant', 'cp-t1', 'IR', 'IRR'),
              ($2, 'Secondary Pack Tenant', 'cp-t2', 'MY', 'MYR')
       ON CONFLICT (id) DO UPDATE
         SET country_code = EXCLUDED.country_code,
             book_currency_code = EXCLUDED.book_currency_code`,
      [T1, T2],
    );
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('runs APP_GUARD before APP_INTERCEPTOR and resolves each tenant pack inside TenantScope as roxira_app', async () => {
    const registry = new CountryPackRegistry('IR');
    registry.register(
      createIranPack({
        statutory: {
          findForYear: jest.fn().mockResolvedValue([]),
          findLatest: jest.fn().mockResolvedValue(null),
        } as never,
      }),
    );
    registry.register(createMalaysiaPack());

    const scopeSpy = jest.spyOn(testDb.scope, 'run');
    const tenantsRepo = new TenantsRepository(testDb.app.getRepository(TenantEntity), testDb.scope);

    const moduleRef = await Test.createTestingModule({
      controllers: [PgTestPackController],
      providers: [
        { provide: CountryPackRegistry, useValue: registry },
        { provide: TenantsRepository, useValue: tenantsRepo },
        CountryPackResolver,
        CountryPackInterceptor,
        { provide: APP_GUARD, useClass: HeaderTenantGuard },
        { provide: APP_INTERCEPTOR, useExisting: CountryPackInterceptor },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const unauthRes = await request(app.getHttpServer()).get('/pg-test-pack').expect(200);
      expect(unauthRes.body).toEqual({
        reqCountry: 'IR',
        clsCountry: 'IR',
        currency: 'IRR',
      });

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer()).get('/pg-test-pack').set('x-test-tenant', T1).expect(200),
        request(app.getHttpServer()).get('/pg-test-pack').set('x-test-tenant', T2).expect(200),
      ]);

      expect(res1.body).toEqual({
        reqCountry: 'IR',
        clsCountry: 'IR',
        currency: 'IRR',
      });
      expect(res2.body).toEqual({
        reqCountry: 'MY',
        clsCountry: 'MY',
        currency: 'MYR',
      });
      expect(scopeSpy).toHaveBeenCalledWith(T1, expect.any(Function));
      expect(scopeSpy).toHaveBeenCalledWith(T2, expect.any(Function));
    } finally {
      scopeSpy.mockRestore();
      await app.close();
    }
  });
});
