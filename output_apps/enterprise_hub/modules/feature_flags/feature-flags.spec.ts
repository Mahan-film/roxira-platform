import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InMemoryProvider, OpenFeature } from '@openfeature/server-sdk';
import { CountryPackResolver } from '../country_packs/country-pack.resolver';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { RequireFlag } from './require-flag.decorator';

const onOff = { on: true, off: false };

function memoryProvider(): InMemoryProvider {
  return new InMemoryProvider({
    'country-pack.de.enabled': {
      disabled: false,
      variants: onOff,
      defaultVariant: 'off',
      contextEvaluator: (ctx) =>
        ctx.countryPack === 'DE' && ctx.tenantId === 'tenant-de' ? 'on' : 'off',
    },
    'assistant.ai-drafts': {
      disabled: false,
      variants: onOff,
      defaultVariant: 'on',
      contextEvaluator: (ctx) =>
        ctx.tenantId === 'tenant-dead' ? 'off' : 'on',
    },
  });
}

async function serviceWith(provider: InMemoryProvider | null) {
  const svc = new FeatureFlagsService(provider);
  await svc.onModuleInit();
  return svc;
}

afterEach(async () => {
  await OpenFeature.clearProviders();
});

describe('FeatureFlagsService', () => {
  it('targets by tenant id and country pack', async () => {
    const svc = await serviceWith(memoryProvider());
    expect(
      await svc.isEnabled('country-pack.de.enabled', {
        tenantId: 'tenant-de',
        countryPack: 'de',
      }),
    ).toBe(true);
    expect(
      await svc.isEnabled('country-pack.de.enabled', {
        tenantId: 'tenant-de',
        countryPack: 'IR',
      }),
    ).toBe(false);
    expect(
      await svc.isEnabled('country-pack.de.enabled', {
        tenantId: 'other',
        countryPack: 'DE',
      }),
    ).toBe(false);
  });

  it('supports a per-tenant kill switch', async () => {
    const svc = await serviceWith(memoryProvider());
    expect(
      await svc.isEnabled('assistant.ai-drafts', { tenantId: 'tenant-dead' }),
    ).toBe(false);
    expect(
      await svc.isEnabled('assistant.ai-drafts', { tenantId: 'tenant-ok' }),
    ).toBe(true);
  });

  it('falls back when the flag is unknown: closed by default, open when asked', async () => {
    const svc = await serviceWith(memoryProvider());
    expect(await svc.isEnabled('does.not.exist', { tenantId: 't' })).toBe(
      false,
    );
    expect(
      await svc.isEnabled(
        'does.not.exist',
        { tenantId: 't' },
        { failOpen: true },
      ),
    ).toBe(true);
  });

  it('uses the per-flag fallback when no provider is configured (flagd down)', async () => {
    const svc = await serviceWith(null);
    expect(await svc.isEnabled('country-pack.de.enabled')).toBe(false); // new feature: closed
    expect(await svc.isEnabled('assistant.ai-drafts')).toBe(true); // existing feature: open
    expect(
      await svc.isEnabled('assistant.ai-drafts', {}, { failOpen: false }),
    ).toBe(false);
  });

  it('never throws when the provider rejects at boot', async () => {
    const broken = Object.assign(memoryProvider(), {
      initialize: () => Promise.reject(new Error('flagd down')),
    });
    const svc = await serviceWith(broken);
    await expect(
      svc.isEnabled('assistant.ai-drafts', { tenantId: 't' }),
    ).resolves.toBe(true);
    await expect(
      svc.isEnabled('country-pack.de.enabled', { tenantId: 't' }),
    ).resolves.toBe(false);
  });
});

describe('FeatureFlagGuard / @RequireFlag', () => {
  class Dummy {
    @RequireFlag('country-pack.de.enabled')
    de(): void {}
    @RequireFlag('assistant.ai-drafts')
    drafts(): void {}
    plain(): void {}
  }

  const ctxFor = (handler: unknown, request: unknown): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => Dummy,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const packs = (code: string) =>
    ({
      resolveForTenant: jest.fn().mockResolvedValue({ country: code }),
      resolve: jest.fn().mockReturnValue({ country: code }),
    }) as unknown as CountryPackResolver;

  it('allows when the flag is on for the tenant and resolved country pack', async () => {
    const svc = await serviceWith(memoryProvider());
    const guard = new FeatureFlagGuard(new Reflector(), svc, packs('DE'));
    await expect(
      guard.canActivate(
        ctxFor(Dummy.prototype.de, { user: { tenantId: 'tenant-de' } }),
      ),
    ).resolves.toBe(true);
  });

  it('answers 404 when the flag is off for the tenant', async () => {
    const svc = await serviceWith(memoryProvider());
    const guard = new FeatureFlagGuard(new Reflector(), svc, packs('DE'));
    await expect(
      guard.canActivate(
        ctxFor(Dummy.prototype.de, { user: { tenantId: 'someone-else' } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prefers the country pack already on the request', async () => {
    const svc = await serviceWith(memoryProvider());
    const resolver = packs('IR');
    const guard = new FeatureFlagGuard(new Reflector(), svc, resolver);
    await expect(
      guard.canActivate(
        ctxFor(Dummy.prototype.de, {
          user: { tenantId: 'tenant-de' },
          countryPack: { country: 'DE' },
        }),
      ),
    ).resolves.toBe(true);
    expect(resolver.resolveForTenant).not.toHaveBeenCalled();
  });

  it('fails closed for a new feature and open for an existing one when flagd is down', async () => {
    const svc = await serviceWith(null);
    const guard = new FeatureFlagGuard(new Reflector(), svc, packs('DE'));
    const req = { user: { tenantId: 'tenant-de' } };
    await expect(
      guard.canActivate(ctxFor(Dummy.prototype.de, req)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      guard.canActivate(ctxFor(Dummy.prototype.drafts, req)),
    ).resolves.toBe(true);
  });

  it('ignores routes without @RequireFlag', async () => {
    const svc = await serviceWith(null);
    const guard = new FeatureFlagGuard(new Reflector(), svc, packs('DE'));
    await expect(
      guard.canActivate(ctxFor(Dummy.prototype.plain, {})),
    ).resolves.toBe(true);
  });
});
