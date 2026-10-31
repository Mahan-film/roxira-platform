import 'reflect-metadata';
import { TenantsService } from './tenants.service';

interface Mocks {
  tenantsRepository: { findById: jest.Mock; create: jest.Mock };
}

const createService = () => {
  const mocks: Mocks = {
    tenantsRepository: { findById: jest.fn(), create: jest.fn() },
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
});
