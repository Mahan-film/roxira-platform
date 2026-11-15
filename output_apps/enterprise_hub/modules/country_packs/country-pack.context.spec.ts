import 'reflect-metadata';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import {
  CountryPackCls,
  requireCountryPack,
  CURRENT_COUNTRY_PACK,
} from './country-pack.context';
import { CountryPackInterceptor } from './country-pack.interceptor';
import { CountryPackRegistry } from './country-pack.registry';
import { CountryPackResolver } from './country-pack.resolver';
import { CountryPack } from './country-pack.types';
import { createTestPack, TEST_COUNTRY } from './xx/xx.pack';

describe('CountryPack Context & CLS (R4 Decision 2)', () => {
  const xxPack = createTestPack();
  const irPack: CountryPack = {
    interfaceVersion: 1,
    version: '1.0.0',
    country: 'IR',
    name: 'Iran',
    status: 'production',
    locale: {
      languages: ['fa-IR'],
      direction: 'rtl',
      displayDigits: 'arabext',
      currency: { code: 'IRR', minorUnits: 0 },
      timeZone: 'Asia/Tehran',
    },
    calendars: {
      primary: 'jalali',
      fiscalYear: { calendar: 'jalali', startMonth: 1, startDay: 1, labelBy: 'start' },
      weekendDays: [5],
    },
    chartTemplates: [],
    taxRules: [],
    statutory: { knownKeys: () => [], valuesFor: jest.fn(async () => []) },
    reportPack: [],
  };

  it('runs within CountryPackCls and resolves current pack across async points', async () => {
    expect(CountryPackCls.current()).toBeUndefined();

    await CountryPackCls.run(irPack, async () => {
      expect(CountryPackCls.current()?.country).toBe('IR');
      await new Promise((r) => setTimeout(r, 10));
      expect(CountryPackCls.current()?.country).toBe('IR');
    });

    expect(CountryPackCls.current()).toBeUndefined();
  });

  it('isolates concurrent async contexts with different country packs', async () => {
    const task1 = CountryPackCls.run(irPack, async () => {
      for (let i = 0; i < 5; i++) {
        expect(CountryPackCls.current()?.country).toBe('IR');
        await new Promise((r) => setTimeout(r, 5));
      }
      return 'done-1';
    });

    const task2 = CountryPackCls.run(xxPack, async () => {
      for (let i = 0; i < 5; i++) {
        expect(CountryPackCls.current()?.country).toBe(TEST_COUNTRY);
        await new Promise((r) => setTimeout(r, 5));
      }
      return 'done-2';
    });

    const results = await Promise.all([task1, task2]);
    expect(results).toEqual(['done-1', 'done-2']);
  });

  it('requireCountryPack returns pack from request when present', () => {
    const req = { countryPack: xxPack };
    expect(requireCountryPack(req).country).toBe(TEST_COUNTRY);
  });

  it('requireCountryPack falls back to CLS store if omitted from request', async () => {
    await CountryPackCls.run(irPack, () => {
      expect(requireCountryPack({}).country).toBe('IR');
      expect(requireCountryPack().country).toBe('IR');
    });
  });

  it('requireCountryPack throws descriptive error if neither request nor CLS has pack', () => {
    expect(() => requireCountryPack({})).toThrow(
      'No CountryPack is bound to the current request or async context',
    );
  });

  describe('CountryPackResolver', () => {
    const registry = new CountryPackRegistry('IR');
    registry.register(irPack);
    registry.register(xxPack);

    const mockTenantsRepo = {
      findById: jest.fn(),
    };

    const resolver = new CountryPackResolver(registry, mockTenantsRepo as never);

    it('resolves by country code or defaults to IR', () => {
      expect(resolver.resolve('XX').country).toBe(TEST_COUNTRY);
      expect(resolver.resolve('IR').country).toBe('IR');
      expect(resolver.resolve(null).country).toBe('IR');
      expect(resolver.resolve(undefined).country).toBe('IR');
    });

    it('resolves for tenant based on tenantsRepository', async () => {
      mockTenantsRepo.findById.mockResolvedValueOnce({
        id: 'tenant-xx',
        countryCode: 'XX',
      });
      const resolved = await resolver.resolveForTenant('tenant-xx');
      expect(resolved.country).toBe(TEST_COUNTRY);

      mockTenantsRepo.findById.mockResolvedValueOnce(null);
      const fallback = await resolver.resolveForTenant('tenant-missing');
      expect(fallback.country).toBe('IR');
    });

    it('currentPack returns CLS pack or falls back to default', async () => {
      expect(resolver.currentPack().country).toBe('IR');
      await CountryPackCls.run(xxPack, () => {
        expect(resolver.currentPack().country).toBe(TEST_COUNTRY);
      });
    });
  });

  describe('CountryPackInterceptor', () => {
    const registry = new CountryPackRegistry('IR');
    registry.register(irPack);
    registry.register(xxPack);

    const mockTenantsRepo = {
      findById: jest.fn(),
    };
    const resolver = new CountryPackResolver(registry, mockTenantsRepo as never);
    const interceptor = new CountryPackInterceptor(resolver);

    it('intercepts request, attaches pack to request, and scopes execution in CLS', async () => {
      mockTenantsRepo.findById.mockResolvedValueOnce({
        id: 'tenant-custom',
        countryCode: 'XX',
      });

      const request: Record<string, unknown> = {
        user: { tenantId: 'tenant-custom' },
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;

      let observedInHandler: string | undefined;
      const callHandler: CallHandler = {
        handle: () => {
          observedInHandler = CountryPackCls.current()?.country;
          return of({ success: true });
        },
      };

      const result$ = await interceptor.intercept(context, callHandler);
      const res = await lastValueFrom(result$);

      expect(res).toEqual({ success: true });
      expect(request.countryPack).toBe(xxPack);
      expect(observedInHandler).toBe(TEST_COUNTRY);
      // Outside the interceptor, CLS store is clear
      expect(CountryPackCls.current()).toBeUndefined();
    });
  });
});
