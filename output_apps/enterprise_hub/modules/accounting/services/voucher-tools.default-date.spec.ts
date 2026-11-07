import { tehranIsoDate } from '../../hr/services/jalali-period';
import { VoucherToolsService } from './voucher-tools.service';

describe('VoucherToolsService.copyVoucher default date', () => {
  it('uses today in Tehran when no date is given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 2 });
    const repo = {
      findEntryById: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'A', description: 'd', lines: [] }),
      findDimensionCodesByIds: jest.fn().mockResolvedValue(new Map()),
      findEntryByNumber: jest.fn().mockResolvedValue(null),
    };
    await new VoucherToolsService(repo as never, { createJournalEntry: create } as never).copyVoucher('t', 1, {});
    expect(create.mock.calls[0][1].date).toBe(tehranIsoDate(new Date()));
  });
});
