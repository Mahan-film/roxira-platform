import { BulkPostService } from './bulk-post.service';
import { BulkJob } from './bulk-import.types';

const T = '11111111-1111-4111-8111-111111111111';

function setup(rowsTotal: number, linesPerVoucher: number) {
  const rows = Array.from({ length: rowsTotal }, (_, i) => ({
    rowNo: i + 1,
    cells: [`V${Math.floor(i / linesPerVoucher)}`, String(i + 1)],
  }));
  const job = {
    id: 'job',
    fileName: 'lines.csv',
    status: 'posting',
    tables: [{ idx: 0, name: 'lines', columns: ['voucher', 'amount'], rows: rowsTotal }],
    review: [{ name: 'lines', mapping: { voucher: 'voucherNo', amount: 'amount' } }],
  } as unknown as BulkJob;
  const repo: any = {
    getJob: jest.fn(async () => job),
    update: jest.fn(async (_t: string, _id: string, patch: any) => void Object.assign(job, patch)),
    readRows: jest.fn(async (_t: string, _id: string, _idx: number, after: number, limit: number) => rows.filter((r) => r.rowNo > after).slice(0, limit)),
  };
  const commits: { voucher: string; rowNumber: number }[][] = [];
  const adapter: any = {
    key: 'accounting-journal-lines',
    fields: [
      { key: 'voucherNo', labelFa: 'سند', required: true, type: 'text', synonyms: [] },
      { key: 'amount', labelFa: 'مبلغ', required: true, type: 'text', synonyms: [] },
    ],
    duplicateKeys: () => [],
    findExistingDuplicateKeys: async () => [],
    commit: jest.fn(async (_t: string, records: any[]) => {
      commits.push(records.map((r) => ({ voucher: String(r.values.voucherNo), rowNumber: r.rowNumber })));
      return { inserted: records.map((r) => ({ ownerId: r.rowNumber, rowNumber: r.rowNumber })), failed: [] };
    }),
  };
  const registry: any = { get: (k: string) => (k === adapter.key ? adapter : null) };
  const batches: any = { createBatch: jest.fn(), addItems: jest.fn(), setInserted: jest.fn(), removeBatch: jest.fn() };
  const jobs: any = { cleanup: jest.fn() };
  return { service: new BulkPostService(repo, registry, batches, jobs), job, commits, batches, jobs, repo };
}

describe('BulkPostService', () => {
  it('posts every row in pages, never splitting a voucher across adapter calls', async () => {
    const { service, job, commits, batches, jobs } = setup(4_501, 3);
    await service.post(T, 'job', [{ idx: 0, entity: 'accounting-journal-lines', mapping: {} }], 'batch-1');
    expect(commits.length).toBeGreaterThan(1);
    const posted = commits.flat();
    expect(posted).toHaveLength(4_501);
    expect(new Set(posted.map((p) => p.rowNumber)).size).toBe(4_501);
    // row numbers are global (header = 1), not restarted per page
    expect(Math.min(...posted.map((p) => p.rowNumber))).toBe(2);
    expect(Math.max(...posted.map((p) => p.rowNumber))).toBe(4_502);
    for (const call of commits) {
      const counts = new Map<string, number>();
      call.forEach((r) => counts.set(r.voucher, (counts.get(r.voucher) ?? 0) + 1));
      const incomplete = [...counts.entries()].filter(([, n]) => n !== 3);
      // only the very last voucher may be short (4 501 rows = 1 500 vouchers of 3 + one line)
      expect(incomplete.every(([v]) => v === 'V1500')).toBe(true);
    }
    expect(batches.createBatch).toHaveBeenCalledWith(T, expect.objectContaining({ id: 'batch-1' }));
    expect(batches.setInserted).toHaveBeenCalledWith(T, 'batch-1', 4_501);
    expect(job.status).toBe('posted');
    expect(jobs.cleanup).toHaveBeenCalled();
  });

  it('leaves the job ready and the partial batch undoable when an adapter throws', async () => {
    const { service, job, batches } = setup(10, 1);
    const registry: any = (service as any).registry;
    registry.get('accounting-journal-lines').commit = jest.fn(async () => {
      throw new Error('db down');
    });
    await expect(service.post(T, 'job', [{ idx: 0, entity: 'accounting-journal-lines', mapping: {} }], 'b2')).rejects.toThrow('db down');
    expect(job.status).toBe('ready');
    expect(batches.setInserted).toHaveBeenCalledWith(T, 'b2', 0);
  });

  it('ignores a job that is not in the posting state', async () => {
    const { service, job, commits } = setup(10, 1);
    job.status = 'ready';
    await service.post(T, 'job', [{ idx: 0, entity: 'accounting-journal-lines', mapping: {} }], 'b3');
    expect(commits).toHaveLength(0);
  });
});
