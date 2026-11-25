import { Controller, Get, Req } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { CountryPackCls, RequestWithCountryPack } from './country-pack.context';
import { CountryPackInterceptor } from './country-pack.interceptor';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPackResolver } from './country-pack.resolver';
import { createIranPack } from './ir/ir.pack';
import { createMalaysiaPack } from './my/my.pack';

@Controller('test-pack')
class TestPackController {
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

describe('CountryPackInterceptor (T338 / #1287)', () => {
  it('resolves the second registered pack (MY) per HTTP request into request.countryPack and CountryPackCls', async () => {
    const registry = new CountryPackRegistry('IR');
    registry.register(
      createIranPack({
        statutory: {
          findForYear: jest.fn().mockResolvedValue([]),
          findLatest: jest.fn().mockResolvedValue(null),
        } as any,
      }),
    );
    registry.register(createMalaysiaPack());

    const tenantsService = {
      findById: jest.fn(async (id: string) => {
        if (id === 'tenant-my') return { id, countryCode: 'MY', bookCurrencyCode: 'MYR' };
        return { id, countryCode: 'IR', bookCurrencyCode: 'IRR' };
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TestPackController],
      providers: [
        { provide: CountryPackRegistry, useValue: registry },
        { provide: TenantsRepository, useValue: tenantsService },
        CountryPackResolver,
        CountryPackInterceptor,
        { provide: APP_INTERCEPTOR, useExisting: CountryPackInterceptor },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      const tid = req.headers['x-test-tenant'];
      if (tid) req.user = { tenantId: String(tid) };
      next();
    });
    await app.init();

    try {
      const myRes = await request(app.getHttpServer())
        .get('/test-pack')
        .set('x-test-tenant', 'tenant-my')
        .expect(200);
      expect(myRes.body).toEqual({
        reqCountry: 'MY',
        clsCountry: 'MY',
        currency: 'MYR',
      });

      const irRes = await request(app.getHttpServer())
        .get('/test-pack')
        .set('x-test-tenant', 'tenant-ir')
        .expect(200);
      expect(irRes.body).toEqual({
        reqCountry: 'IR',
        clsCountry: 'IR',
        currency: 'IRR',
      });
    } finally {
      await app.close();
    }
  });
});
