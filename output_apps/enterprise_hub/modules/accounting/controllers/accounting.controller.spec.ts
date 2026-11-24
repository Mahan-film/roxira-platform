import { Test } from '@nestjs/testing';
import { AccountingController } from './accounting.controller';
import { AccountingService } from '../services/accounting.service';
import { VoucherToolsService } from '../services/voucher-tools.service';
import { JournalEntryStatus } from '../enums/accounting.enum';
import type { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';

describe('AccountingController.changeJournalEntryStatus', () => {
  let controller: AccountingController;
  const changeVoucherStatus = jest.fn().mockResolvedValue({ id: 42, status: JournalEntryStatus.POSTED });

  beforeEach(async () => {
    changeVoucherStatus.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountingController],
      providers: [
        {
          provide: AccountingService,
          useValue: { changeVoucherStatus },
        },
        {
          provide: VoucherToolsService,
          useValue: {},
        },
      ],
    }).compile();
    controller = moduleRef.get(AccountingController);
  });

  it('derives actorRole from the authenticated session, never from the request body', async () => {
    const req = {
      tenantId: 'tenant-1',
      user: { sub: 'user-1', role: 'owner', tenantId: 'tenant-1' },
      access: { roleKey: 'owner', userId: 'user-1' },
    } as unknown as AuthenticatedRequest;

    const dto = { status: JournalEntryStatus.POSTED, expectedVersion: 1, actorRole: 'viewer' } as never;
    await controller.changeJournalEntryStatus(req, 42, dto);

    expect(changeVoucherStatus).toHaveBeenCalledWith(
      'tenant-1',
      42,
      JournalEntryStatus.POSTED,
      1,
      'user-1',
      { actorRole: 'owner', actorUserId: 'user-1' },
    );
  });

  it('passes non-permitted session role (e.g. accountant) to changeVoucherStatus', async () => {
    const req = {
      tenantId: 'tenant-1',
      user: { sub: 'user-2', role: 'accountant', tenantId: 'tenant-1' },
      access: { roleKey: 'accountant', userId: 'user-2' },
    } as unknown as AuthenticatedRequest;

    await controller.changeJournalEntryStatus(req, 42, { status: JournalEntryStatus.POSTED });

    expect(changeVoucherStatus).toHaveBeenCalledWith(
      'tenant-1',
      42,
      JournalEntryStatus.POSTED,
      undefined,
      'user-2',
      { actorRole: 'accountant', actorUserId: 'user-2' },
    );
  });
});
