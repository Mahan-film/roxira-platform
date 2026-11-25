import { NotFoundException } from '@nestjs/common';
import {
  FuzzyDuplicateQueueService,
  FuzzyRecordInput,
  tokenSortSimilarity,
} from './analysis/fuzzy-duplicate-queue';

describe('Fuzzy Duplicate Queue for parties/items (T330 / #1153)', () => {
  it('computes high token-sort similarity across Persian/Arabic variants and word order', () => {
    expect(tokenSortSimilarity('شرکت البرز تجارت', 'شركت تجارت البرز')).toBe(100);
    expect(tokenSortSimilarity('لپ‌تاپ لنوو ۱۵ اینچ', 'لپ تاپ لنوو 15 اینچ')).toBe(100);
    expect(tokenSortSimilarity('فروشگاه بهار', 'خودروسازی آسمان')).toBeLessThan(50);
  });

  it('queues known party duplicates and merges NONE without an explicit click', () => {
    const queue = new FuzzyDuplicateQueueService();
    const parties: FuzzyRecordInput[] = [
      { id: 'p-1', code: 'C01', name: 'شرکت البرز تجارت', nationalId: '1010101010' },
      { id: 'p-2', code: 'C02', name: 'شركت تجارت البرز', phone: '09123456789' },
      { id: 'p-3', code: 'C03', name: 'علی محمدی', phone: '۰۹۱۲۳۴۵۶۷۸۹' },
      { id: 'p-4', code: 'C04', name: 'محمدی علی', phone: '09123456789' },
      { id: 'p-5', code: 'C05', name: 'صنایع فولاد خوزستان', nationalId: '2020202020' },
    ];

    const snapshotBefore = JSON.stringify(parties);
    const queued = queue.enqueueCandidates('tenant-a', {
      entity: 'parties',
      records: parties,
    });

    expect(queued.length).toBeGreaterThanOrEqual(2);
    expect(queued.every((c) => c.status === 'PENDING' && c.merged === false)).toBe(true);
    expect(JSON.stringify(parties)).toBe(snapshotBefore);

    const hasAlborzPair = queued.some(
      (c) =>
        [c.left.id, c.right.id].sort().join(',') === 'p-1,p-2' && c.score === 100,
    );
    const hasAliPair = queued.some(
      (c) =>
        [c.left.id, c.right.id].sort().join(',') === 'p-3,p-4' && c.score >= 90,
    );
    expect(hasAlborzPair).toBe(true);
    expect(hasAliPair).toBe(true);

    // Distinct party p-5 should not be paired with others
    expect(queued.some((c) => c.left.id === 'p-5' || c.right.id === 'p-5')).toBe(false);

    // Explicit click required to merge or dismiss
    const first = queue.listPending('tenant-a', 'parties')[0];
    const resolved = queue.resolveCandidate('tenant-a', first.id, 'MERGE');
    expect(resolved.status).toBe('MERGED');
    expect(resolved.merged).toBe(true);
    expect(queue.listPending('tenant-a', 'parties').some((c) => c.id === first.id)).toBe(false);
  });

  it('queues known inventory item duplicates and isolates tenants', () => {
    const queue = new FuzzyDuplicateQueueService();
    const items: FuzzyRecordInput[] = [
      { id: 'i-1', code: 'SKU-1', name: 'لپ‌تاپ لنوو ۱۵ اینچ', barcode: '6260000111222' },
      { id: 'i-2', code: 'SKU-2', name: 'لپ تاپ لنوو 15 اینچ' },
      { id: 'i-3', code: 'SKU-3', name: 'کاغذ A4 بسته ۵۰۰ برگ', barcode: '6269999888777' },
    ];

    const queued = queue.enqueueCandidates('tenant-a', {
      entity: 'inventory-items',
      records: items,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('PENDING');
    expect(queued[0].merged).toBe(false);
    expect([queued[0].left.id, queued[0].right.id].sort()).toEqual(['i-1', 'i-2']);

    // Tenant B cannot see or resolve Tenant A's candidates
    expect(queue.listPending('tenant-b')).toEqual([]);
    expect(() => queue.resolveCandidate('tenant-b', queued[0].id, 'DISMISS')).toThrow(
      NotFoundException,
    );

    const dismissed = queue.resolveCandidate('tenant-a', queued[0].id, 'DISMISS');
    expect(dismissed.status).toBe('DISMISSED');
    expect(dismissed.merged).toBe(false);
  });
});
