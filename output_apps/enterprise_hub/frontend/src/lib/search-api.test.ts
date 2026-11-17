import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  searchUniversal,
  getEntityTypeLabelFa,
  type SearchItem,
} from './search-api.ts';

describe('searchUniversal client', () => {
  test('returns empty array for empty or whitespace query without network call', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;

    const res1 = await searchUniversal('');
    const res2 = await searchUniversal('   ');

    assert.deepStrictEqual(res1, []);
    assert.deepStrictEqual(res2, []);
    assert.strictEqual(called, false);
  });

  test('calls /search with properly encoded query parameters', async () => {
    let requestedUrl = '';
    const mockItems: SearchItem[] = [
      {
        id: '1',
        type: 'customer',
        title: 'شرکت آلفا',
        subtitle: 'کد C-1',
        url: '/app/crm?search=C-1',
      },
    ];

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          query: 'آلفا',
          total: 1,
          items: mockItems,
          latencyMs: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const res = await searchUniversal('آلفا', { limit: 15 });

    assert.strictEqual(requestedUrl.includes('q=%D8%A2%D9%84%D9%81%D8%A7'), true);
    assert.strictEqual(requestedUrl.includes('limit=15'), true);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].title, 'شرکت آلفا');
  });

  test('handles HTTP error gracefully without throwing', async () => {
    globalThis.fetch = (async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const res = await searchUniversal('تست');
    assert.deepStrictEqual(res, []);
  });

  test('handles network failure gracefully without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Network failure');
    }) as unknown as typeof fetch;

    const res = await searchUniversal('تست');
    assert.deepStrictEqual(res, []);
  });

  test('maps entity types to Persian labels correctly', () => {
    assert.strictEqual(getEntityTypeLabelFa('customer'), 'مشتریان');
    assert.strictEqual(getEntityTypeLabelFa('product'), 'کالاها و خدمات');
    assert.strictEqual(getEntityTypeLabelFa('invoice'), 'صورتحساب‌های فروش');
    assert.strictEqual(getEntityTypeLabelFa('cheque'), 'چک‌ها و اسناد دریافتنی/پرداختنی');
    assert.strictEqual(getEntityTypeLabelFa('account'), 'حساب‌های دفتر کل');
    assert.strictEqual(getEntityTypeLabelFa('page'), 'صفحات و امکانات');
  });
});
