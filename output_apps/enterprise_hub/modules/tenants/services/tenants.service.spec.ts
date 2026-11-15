import 'reflect-metadata';
import { TenantsService } from './tenants.service';

interface Mocks {
  tenantsRepository: {
    findById: jest.Mock;
    create: jest.Mock;
    updateSettings: jest.Mock;
    updateDefaultVatRate: jest.Mock;
  };
}

const createService = () => {
  const mocks: Mocks = {
    tenantsRepository: {
      findById: jest.fn(),
      create: jest.fn(),
      updateSettings: jest.fn(),
      updateDefaultVatRate: jest.fn(),
    },
  };

  const service = new TenantsService(mocks.tenantsRepository as never);

  return { service, mocks };
};

describe('TenantsService', () => {
  it('resolves the current tenant from the JWT tenant id', async () => {
    const { service, mocks } = createService();
    const tenant = { id: 'tenant-1', name: 'Acme', slug: 'acme-1' };
    mocks.tenantsRepository.findById.mockResolvedValue(tenant);

    await expect(service.findMyTenant('tenant-1')).resolves.toBe(tenant);
  });

  it('updates localisation settings including uppercase country and book currency', async () => {
    const { service, mocks } = createService();
    const updated = {
      id: 'tenant-1',
      name: 'Acme',
      countryCode: 'IR',
      bookCurrencyCode: 'IRR',
      defaultCalendar: 'jalali',
      timezone: 'Asia/Tehran',
      locale: 'fa-IR',
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.1,
    };
    mocks.tenantsRepository.updateSettings.mockResolvedValue(updated);

    const res = await service.updateSettings('tenant-1', {
      countryCode: 'ir',
      bookCurrencyCode: 'irr',
      defaultCalendar: 'jalali',
      timezone: 'Asia/Tehran',
      locale: 'fa-IR',
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.1,
    });

    expect(mocks.tenantsRepository.updateSettings).toHaveBeenCalledWith('tenant-1', {
      countryCode: 'IR',
      bookCurrencyCode: 'IRR',
      defaultCalendar: 'jalali',
      timezone: 'Asia/Tehran',
      locale: 'fa-IR',
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.1,
    });
    expect(res).toBe(updated);
  });

  it('throws NotFoundException when tenant to update does not exist', async () => {
    const { service, mocks } = createService();
    mocks.tenantsRepository.updateSettings.mockResolvedValue(null);

    await expect(
      service.updateSettings('missing', { defaultVatRate: 0.1 }),
    ).rejects.toThrow('سازمانی برای حساب شما یافت نشد.');
  });
});
