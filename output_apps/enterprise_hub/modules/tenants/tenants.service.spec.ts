import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CountryPackRegistry } from '../country_packs/country-pack.registry';
import { createIranPack } from '../country_packs/ir/ir.pack';
import { createMalaysiaPack } from '../country_packs/my/my.pack';
import { TenantsRepository } from './repositories/tenants.repository';
import { TenantsService } from './services/tenants.service';

describe('TenantsService.updateSettings country & currency validation (T338 / #1287)', () => {
  let registry: CountryPackRegistry;
  let repo: jest.Mocked<Pick<TenantsRepository, 'findById' | 'updateSettings'>>;
  let service: TenantsService;

  beforeEach(() => {
    registry = new CountryPackRegistry('IR');
    registry.register(
      createIranPack({
        statutory: {
          findForYear: jest.fn().mockResolvedValue([]),
          findLatest: jest.fn().mockResolvedValue(null),
        } as any,
      }),
    );
    registry.register(createMalaysiaPack());

    repo = {
      findById: jest.fn().mockResolvedValue({
        id: 't1',
        countryCode: 'IR',
        bookCurrencyCode: 'IRR',
      } as any),
      updateSettings: jest.fn().mockImplementation(async (_id, fields) => ({
        id: 't1',
        countryCode: fields.countryCode ?? 'IR',
        bookCurrencyCode: fields.bookCurrencyCode ?? 'IRR',
      } as any)),
    };
    service = new TenantsService(repo as any, registry);
  });

  it('accepts a registered country pack and its matching book currency', async () => {
    const res = await service.updateSettings('t1', {
      countryCode: 'my',
      bookCurrencyCode: 'myr',
    });
    expect(res.countryCode).toBe('MY');
    expect(res.bookCurrencyCode).toBe('MYR');
    expect(repo.updateSettings).toHaveBeenCalledWith('t1', {
      countryCode: 'MY',
      bookCurrencyCode: 'MYR',
    });
  });

  it('aligns bookCurrencyCode when countryCode changes without an explicit currency', async () => {
    const res = await service.updateSettings('t1', { countryCode: 'MY' });
    expect(res.countryCode).toBe('MY');
    expect(res.bookCurrencyCode).toBe('MYR');
  });

  it('rejects an unregistered countryCode (fail closed)', async () => {
    await expect(
      service.updateSettings('t1', { countryCode: 'ZZ' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });

  it('rejects a bookCurrencyCode that does not match the country pack', async () => {
    await expect(
      service.updateSettings('t1', { countryCode: 'MY', bookCurrencyCode: 'IRR' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSettings('t1', { bookCurrencyCode: 'USD' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });

  it('fails closed when CountryPackRegistry is unavailable', async () => {
    const noRegistryService = new TenantsService(repo as any, undefined);
    await expect(
      noRegistryService.updateSettings('t1', { countryCode: 'IR' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      noRegistryService.updateSettings('t1', { bookCurrencyCode: 'IRR' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when tenant does not exist', async () => {
    repo.findById.mockResolvedValueOnce(null);
    await expect(
      service.updateSettings('missing', { countryCode: 'IR' }),
    ).rejects.toThrow(NotFoundException);
  });
});
