import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EffectiveTieOutConfigRegistry } from '../analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine } from '../analysis/import-tie-out.engine';
import { CutoverWizardService } from './cutover-wizard.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('CutoverWizardService (unit, #1217)', () => {
  let service: CutoverWizardService;
  let accounting: {
    postTypedEntry: jest.Mock;
    lockPeriod: jest.Mock;
    isPeriodLocked: jest.Mock;
    createJournalEntry: jest.Mock;
  };
  let cutoverRepo: {
    runInTenantTransaction: jest.Mock;
    acquireTenantCutoverLock: jest.Mock;
    findActive: jest.Mock;
    createCutover: jest.Mock;
  };

  const validRequest = () => ({
    cutoverDate: '2026-01-01',
    preCutoverLockDate: '2025-12-31',
    openingBalances: [
      { accountCode: '1010', description: 'صندوق', debit: '1000000' },
      { accountCode: '3010', description: 'سرمایه', credit: '1000000' },
    ],
  });

  beforeEach(() => {
    const configRegistry = new EffectiveTieOutConfigRegistry();
    const tieOutEngine = new ImportTieOutEngine(configRegistry);
    accounting = {
      postTypedEntry: jest.fn().mockResolvedValue({ id: 10, entryNumber: 'OB-CUTOVER-2026-01-01' }),
      lockPeriod: jest.fn().mockResolvedValue({ id: 20 }),
      isPeriodLocked: jest.fn().mockResolvedValue(true),
      createJournalEntry: jest.fn(),
    };
    const fakeManager = {} as never;
    cutoverRepo = {
      runInTenantTransaction: jest.fn((_t, work) => work(fakeManager)),
      acquireTenantCutoverLock: jest.fn().mockResolvedValue(undefined),
      findActive: jest.fn().mockResolvedValue(null),
      createCutover: jest.fn().mockResolvedValue({
        id: 'cutover-1',
        cutoverDate: '2026-01-01',
        preCutoverLockDate: '2025-12-31',
        periodLockId: 20,
        openingJournalEntryId: 10,
        legacyNumberPrefix: 'LEGACY-',
        executedBy: 'user-owner-1',
      }),
    };
    service = new CutoverWizardService(
      tieOutEngine,
      configRegistry,
      accounting as never,
      cutoverRepo as never,
    );
  });

  it('rejects empty body / fewer than 2 opening lines and never locks or posts', async () => {
    expect(() => service.evaluatePreflight({} as never)).toThrow(BadRequestException);
    expect(() =>
      service.evaluatePreflight({ cutoverDate: '2026-01-01', openingBalances: [] }),
    ).toThrow(BadRequestException);
    await expect(
      service.executeGoLive(TENANT_ID, 'user-owner-1', {
        cutoverDate: '2026-01-01',
        openingBalances: [],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(accounting.postTypedEntry).not.toHaveBeenCalled();
    expect(accounting.lockPeriod).not.toHaveBeenCalled();
  });

  it('rejects AI actor and missing actor BEFORE any DB write or transaction', async () => {
    await expect(
      service.executeGoLive(TENANT_ID, 'ai:assistant', validRequest()),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.executeGoLive(TENANT_ID, '   ', validRequest()),
    ).rejects.toThrow(ForbiddenException);
    expect(cutoverRepo.runInTenantTransaction).not.toHaveBeenCalled();
    expect(accounting.postTypedEntry).not.toHaveBeenCalled();
    expect(accounting.lockPeriod).not.toHaveBeenCalled();
  });

  it('validates real calendar dates, preCutoverLockDate < cutoverDate, and debit/credit signs', async () => {
    await expect(
      service.executeGoLive(TENANT_ID, 'user-1', { ...validRequest(), cutoverDate: '2026-02-30' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.executeGoLive(TENANT_ID, 'user-1', {
        ...validRequest(),
        cutoverDate: '2026-01-01',
        preCutoverLockDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(() =>
      service.evaluatePreflight({
        cutoverDate: '2026-01-01',
        openingBalances: [
          { accountCode: '1010', debit: '-100' },
          { accountCode: '3010', credit: '100' },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.evaluatePreflight({
        cutoverDate: '2026-01-01',
        openingBalances: [
          { accountCode: '1010', debit: '100', credit: '100' },
          { accountCode: '3010', credit: '100' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('blocks preflight when AP control account is present without AP subledger or controlTotal', () => {
    const res = service.evaluatePreflight({
      cutoverDate: '2026-01-01',
      openingBalances: [
        { accountCode: '1010', debit: '2000000' },
        { accountCode: '2010', credit: '2000000' },
      ],
    });
    expect(res.passed).toBe(false);
    expect(res.blockersFa.some((b) => b.includes('AP'))).toBe(true);
  });

  it('blocks replay when an active cutover already exists', async () => {
    cutoverRepo.findActive.mockResolvedValueOnce({ id: 'existing-cutover', cutoverDate: '2026-01-01' });
    await expect(
      service.executeGoLive(TENANT_ID, 'user-owner-1', validRequest()),
    ).rejects.toThrow(ConflictException);
    expect(accounting.postTypedEntry).not.toHaveBeenCalled();
    expect(accounting.lockPeriod).not.toHaveBeenCalled();
  });

  it('verifyPreCutoverLock is strictly a dry check (requires testDate and NEVER writes to ledger)', async () => {
    await expect(service.verifyPreCutoverLock(TENANT_ID, {} as never)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.verifyPreCutoverLock(TENANT_ID, { testDate: '2026-02-30' }),
    ).rejects.toThrow(BadRequestException);

    const res = await service.verifyPreCutoverLock(TENANT_ID, { testDate: '2025-12-31' });
    expect(res).toMatchObject({ locked: true, dryCheck: true, testDate: '2025-12-31' });
    expect(accounting.isPeriodLocked).toHaveBeenCalledTimes(1);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
    expect(accounting.postTypedEntry).not.toHaveBeenCalled();
  });

  it('formats legacy document numbers without renumbering into the live gapless series', () => {
    expect(service.formatLegacyDocumentNumber('LEGACY-', 'INV-9001')).toBe('LEGACY-INV-9001');
    expect(service.formatLegacyDocumentNumber('LEGACY-', 'LEGACY-INV-9001')).toBe('LEGACY-INV-9001');
    expect(() => service.formatLegacyDocumentNumber('LEGACY-', '   ')).toThrow(BadRequestException);
  });
});
