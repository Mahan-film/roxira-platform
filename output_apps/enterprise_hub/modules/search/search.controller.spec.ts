import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';

describe('SearchController', () => {
  let controller: SearchController;
  let mockSearchService: Partial<SearchService>;

  const TENANT_ID = '33333333-3333-4333-8333-333333333333';
  const ACCESS = { roleKey: 'owner' };

  beforeEach(() => {
    mockSearchService = {
      search: jest.fn().mockResolvedValue({
        query: 'تست',
        total: 1,
        items: [
          {
            id: '1',
            type: 'customer',
            title: 'مشتری تست',
            subtitle: 'کد: C-1',
            url: '/app/crm?search=C-1',
          },
        ],
        latencyMs: 5,
      }),
    };
    controller = new SearchController(mockSearchService as SearchService);
  });

  it('delegates search to SearchService with authenticated tenantId', async () => {
    const req = {
      user: {
        tenantId: TENANT_ID,
        userId: 'u1',
      },
      access: ACCESS,
    };

    const res = await controller.search(
      { q: 'تست', limit: 15, types: ['customer'] },
      req as any,
    );

    expect(mockSearchService.search).toHaveBeenCalledWith(
      TENANT_ID,
      'تست',
      15,
      ['customer'],
      ACCESS,
    );
    expect(res.total).toBe(1);
    expect(res.items[0].title).toBe('مشتری تست');
  });

  it('defaults limit to 20 when not specified', async () => {
    const req = {
      user: {
        tenantId: TENANT_ID,
      },
      access: ACCESS,
    };

    await controller.search({ q: 'فاکتور' }, req as any);

    expect(mockSearchService.search).toHaveBeenCalledWith(
      TENANT_ID,
      'فاکتور',
      undefined,
      undefined,
      ACCESS,
    );
  });
});
