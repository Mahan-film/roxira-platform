import { BadRequestException } from '@nestjs/common';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';
import { AccountingService } from '../../accounting/services/accounting.service';
import { EffectiveTieOutConfigRegistry } from '../analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine } from '../analysis/import-tie-out.engine';
import {
  CutoverGoLiveRequestDto,
  CutoverPreflightRequestDto,
} from '../dto/cutover-wizard.dto';
import { CutoverRepository } from '../repositories/cutover.repository';
import { CutoverWizardService } from './cutover-wizard.service';

describe('CutoverWizardService (T327 R32)', () => {
  const TENANT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const ACTOR = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  let service: CutoverWizardService;
  let tieOutEngine: ImportTieOutEngine;
  let mockAccountingService: Partial<AccountingService>;
  let mockCutoverRepository: Partial<CutoverRepository>;
  let activeCutoverRecord: any = null;

  beforeEach(() => {
    activeCutoverRecord = null;
    tieOutEngine = new ImportTieOutEngine(new EffectiveTieOutConfigRegistry());

    mockAccountingService = {
      importOpeningBalances: jest.fn().mockResolvedValue(105),
      createJournalEntry: jest.fn().mockResolvedValue({ id: 105, entryNumber: 'OB-20260321' }),
      lockPeriod: jest.fn().mockImplementation(async (_tenant, _actor, dto) => ({
        id: 77,
        tenantId: TENANT_ID,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        reason: dto.reason,
        lockedAt: new Date().toISOString(),
        lockedBy: ACTOR,
        unlockedAt: null,
        unlockedBy: null,
        unlockReason: null,
      })),
    };

    mockCutoverRepository = {
      findActive: jest.fn().mockImplementation(async () => activeCutoverRecord),
      createCutover: jest.fn().mockImplementation(async (_tenant, input) => {
        activeCutoverRecord = {
          id: input.id ?? 'cutover-1',
          tenantId: TENANT_ID,
          cutoverDate: input.cutoverDate,
          preCutoverLockDate: input.preCutoverLockDate,
          periodLockId: input.periodLockId,
          openingJournalEntryId: input.openingJournalEntryId,
          legacyNumberPrefix: input.legacyNumberPrefix ?? 'LEGACY-',
          isGoLiveActive: input.isGoLiveActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return activeCutoverRecord;
      }),
      listAll: jest.fn().mockImplementation(async () => (activeCutoverRecord ? [activeCutoverRecord] : [])),
    };

    service = new CutoverWizardService(
      tieOutEngine,
      mockAccountingService as AccountingService,
      mockCutoverRepository as CutoverRepository,
    );
  });

  describe('evaluatePreflight & Tie-Out Gatekeeper (R32 D4)', () => {
    it('evaluates balanced trial balance as green', async () => {
      const dto: CutoverPreflightRequestDto = {
        cutoverDate: '2026-03-21',
        openingBalances: [
          { accountCode: '1301', debit: 50_000_000, credit: 0, description: 'پیش‌پرداخت‌ها' },
          { accountCode: '2101', debit: 0, credit: 50_000_000, description: 'حساب‌های پرداختنی تجاری' },
        ],
      };

      const result = await service.evaluatePreflight(TENANT_ID, dto);

      expect(result.allGreen).toBe(true);
      expect(result.canGoLive).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
      expect(result.blockersFa).toHaveLength(0);
      expect(result.items.find((i) => i.name.includes('تراز آزمایشی'))?.matched).toBe(true);
    });

    it('flags imbalanced opening trial balance as non-green discrepancy', async () => {
      const dto: CutoverPreflightRequestDto = {
        cutoverDate: '2026-03-21',
        openingBalances: [
          { accountCode: '1301', debit: 50_000_000, credit: 0 },
          { accountCode: '2101', debit: 0, credit: 40_000_000 }, // 10,000,000 difference!
        ],
      };

      const result = await service.evaluatePreflight(TENANT_ID, dto);

      expect(result.allGreen).toBe(false);
      expect(result.canGoLive).toBe(false);
      expect(result.discrepancies.length).toBeGreaterThan(0);
      expect(result.blockersFa.length).toBeGreaterThan(0);
      expect(result.blockersFa[0]).toContain('متوازن نیست');
    });

    it('evaluates control totals (AR, AP, Stock, Bank) against opening balances', async () => {
      const dto: CutoverPreflightRequestDto = {
        cutoverDate: '2026-03-21',
        openingBalances: [
          { accountCode: '1101', debit: 20_000_000, credit: 0, description: 'حساب دریافتنی مشتریان' },
          { accountCode: '1010', debit: 30_000_000, credit: 0, description: 'موجودی بانک سامان' },
          { accountCode: '2101', debit: 0, credit: 50_000_000, description: 'بستانکاران تجاری' },
        ],
        controlTotals: {
          TRIAL_BALANCE: '0',
          ACCOUNTS_RECEIVABLE: '20000000',
          ACCOUNTS_PAYABLE: '50000000',
          bankBalance: '30000000',
        },
      };

      const result = await service.evaluatePreflight(TENANT_ID, dto);

      expect(result.allGreen).toBe(true);
      expect(result.canGoLive).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
    });

    it('blocks when AR control total differs from opening balance', async () => {
      const dto: CutoverPreflightRequestDto = {
        cutoverDate: '2026-03-21',
        openingBalances: [
          { accountCode: '1101', debit: 20_000_000, credit: 0, description: 'حساب‌های دریافتنی تجاری' },
          { accountCode: '2101', debit: 0, credit: 20_000_000, description: 'حساب‌های پرداختنی' },
        ],
        controlTotals: {
          ACCOUNTS_RECEIVABLE: '25000000', // 5M discrepancy!
        },
      };

      const result = await service.evaluatePreflight(TENANT_ID, dto);

      expect(result.allGreen).toBe(false);
      expect(result.canGoLive).toBe(false);
      expect(result.discrepancies.some((d) => d.category === 'ACCOUNTS_RECEIVABLE')).toBe(true);
    });
  });

  describe('executeGoLive & Cutover Execution', () => {
    it('blocks go-live when tie-outs are not green with BadRequestException (R32 Done When)', async () => {
      const goLiveDto: CutoverGoLiveRequestDto = {
        cutoverDate: '2026-03-21',
        openingBalances: [
          { accountCode: '1010', debit: 100_000_000, credit: 0 },
          { accountCode: '2010', debit: 0, credit: 90_000_000 }, // Discrepancy!
        ],
      };

      await expect(
        service.executeGoLive(TENANT_ID, ACTOR, goLiveDto),
      ).rejects.toThrow(BadRequestException);

      expect(mockAccountingService.lockPeriod).not.toHaveBeenCalled();
      expect(mockAccountingService.importOpeningBalances).not.toHaveBeenCalled();
    });

    it('completes go-live successfully when all tie-outs are green', async () => {
      const goLiveDto: CutoverGoLiveRequestDto = {
        cutoverDate: '2026-03-21',
        legacyNumberPrefix: 'LEGACY-',
        openingBalances: [
          { accountCode: '1301', debit: 50_000_000, credit: 0, description: 'پیش‌پرداخت افتتاحیه' },
          { accountCode: '2101', debit: 0, credit: 50_000_000, description: 'سرمایه اول دوره' },
        ],
      };

      const response = await service.executeGoLive(TENANT_ID, ACTOR, goLiveDto);

      expect(response.status).toBe('completed');
      expect(response.isGoLiveActive).toBe(true);
      expect(response.cutoverDate).toBe('2026-03-21');
      expect(response.preCutoverLockDate).toBe('2026-03-20');
      expect(response.periodLockId).toBe(77);
      expect(response.openingJournalEntryId).toBe(105);
      expect(response.legacyNumberPrefix).toBe('LEGACY-');
      expect(response.tieOutSummary.passed).toBe(true);

      // Verify opening journal was created
      expect(mockAccountingService.createJournalEntry).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          date: '2026-03-21',
          description: expect.stringContaining('سند افتتاحیه'),
          lines: expect.arrayContaining([
            expect.objectContaining({
              accountCode: '1301',
              debit: '50000000',
            }),
          ]),
        }),
      );

      // Verify pre-cutover period was locked
      expect(mockAccountingService.lockPeriod).toHaveBeenCalledWith(
        TENANT_ID,
        ACTOR,
        {
          periodStart: '1970-01-01',
          periodEnd: '2026-03-20',
          reason: expect.stringContaining('قفل قطعی دوره پیش از کات‌اوور'),
        },
      );

      // Verify cutover record was persisted
      expect(mockCutoverRepository.createCutover).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          cutoverDate: '2026-03-21',
          preCutoverLockDate: '2026-03-20',
          periodLockId: 77,
          isGoLiveActive: true,
        }),
      );
    });
  });

  describe('verifyPeriodLockPostingAttempt (R32 Done When)', () => {
    it('verifies period lock when test journal posting rejects with PeriodLockedException', async () => {
      // Simulate active cutover
      activeCutoverRecord = {
        cutoverDate: '2026-03-21',
        preCutoverLockDate: '2026-03-20',
        periodLockId: 77,
        isGoLiveActive: true,
      };

      (mockAccountingService.createJournalEntry as jest.Mock).mockRejectedValueOnce(
        new PeriodLockedException('این دوره حسابداری قفل شده است و امکان ثبت سند وجود ندارد.'),
      );

      const verification = await service.verifyPeriodLockPostingAttempt(TENANT_ID);

      expect(verification.verified).toBe(true);
      expect(verification.errorType).toBe('PeriodLockedException');
      expect(verification.message).toContain('مسدود شد');
      expect(mockAccountingService.createJournalEntry).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          date: '2026-03-20',
        }),
      );
    });

    it('throws BadRequestException if posting attempt does not reject (lock failure)', async () => {
      activeCutoverRecord = {
        cutoverDate: '2026-03-21',
        preCutoverLockDate: '2026-03-20',
        periodLockId: 77,
        isGoLiveActive: true,
      };

      // Posting surprisingly succeeds!
      (mockAccountingService.createJournalEntry as jest.Mock).mockResolvedValueOnce({
        id: 999,
        entryNumber: 'TEST-LOCK-VERIFY',
      });

      await expect(
        service.verifyPeriodLockPostingAttempt(TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Legacy Number Series & Status', () => {
    it('formats original documents with legacy prefix without renumbering into gapless series', () => {
      expect(service.formatLegacyDocumentNumber('1045', 'LEGACY-')).toBe('LEGACY-1045');
      expect(service.formatLegacyDocumentNumber('LEGACY-1045', 'LEGACY-')).toBe('LEGACY-1045');
      expect(service.formatLegacyDocumentNumber('INV-2025-099', 'OLD-')).toBe('OLD-INV-2025-099');
    });

    it('returns cutover status for tenant', async () => {
      activeCutoverRecord = {
        cutoverDate: '2026-03-21',
        preCutoverLockDate: '2026-03-20',
        periodLockId: 77,
        legacyNumberPrefix: 'LEGACY-',
        isGoLiveActive: true,
      };

      const status = await service.getCutoverStatus(TENANT_ID);
      expect(status.isGoLiveActive).toBe(true);
      expect(status.cutoverDate).toBe('2026-03-21');
      expect(status.periodLockId).toBe(77);
      expect(status.legacyNumberPrefix).toBe('LEGACY-');
    });

    it('returns isGoLiveActive: false when no cutover exists', async () => {
      activeCutoverRecord = null;
      const status = await service.getCutoverStatus(TENANT_ID);
      expect(status.isGoLiveActive).toBe(false);
      expect(status.cutoverDate).toBeUndefined();
    });
  });
});
