import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CostCentreReportService, UNASSIGNED_CENTRE_NAME } from './cost-centre-report.service';
import { FinancialReportsService } from './financial-reports.service';
import { LedgerReportRepository } from '../repositories/ledger-report.repository';
import { DimensionRepository } from '../repositories/dimension.repository';
import { DimensionKind, AccountType, AccountLevel, ReportLine } from '../enums/accounting.enum';

describe('CostCentreReportService', () => {
  let service: CostCentreReportService;
  let reportsMock: jest.Mocked<Partial<FinancialReportsService>>;
  let ledgerMock: jest.Mocked<Partial<LedgerReportRepository>>;
  let dimensionsMock: jest.Mocked<Partial<DimensionRepository>>;

  const tenantId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    reportsMock = {
      resolvePeriod: jest.fn().mockResolvedValue({
        fiscalYearId: 1,
        from: '2026-03-21',
        to: '2027-03-20',
      }),
      accounts: jest.fn().mockResolvedValue([
        { id: 10, code: '101', name: 'صندوق', level: AccountLevel.MOEIN, accountType: AccountType.ASSET, parentCode: '10', reportLine: ReportLine.CASH },
        { id: 20, code: '601', name: 'هزینه حقوق', level: AccountLevel.MOEIN, accountType: AccountType.EXPENSE, parentCode: '60', reportLine: null },
      ]),
      toBalance: jest.fn().mockImplementation((row, account) => ({
        account,
        line: account.reportLine ?? ReportLine.OTHER_CURRENT_ASSET,
        inferred: false,
        opening: 0n,
        priorDebit: 0n,
        priorCredit: 0n,
        periodDebit: BigInt(row.periodDebit || 0),
        periodCredit: BigInt(row.periodCredit || 0),
        closeDebit: 0n,
        closeCredit: 0n,
      })),
      summarize: jest.fn().mockImplementation((period, columns, rows) => ({
        period,
        columns,
        rows,
        groups: [],
        totals: {
          openingDebit: 0n,
          openingCredit: 0n,
          periodDebit: 1000n,
          periodCredit: 1000n,
          closingDebit: 0n,
          closingCredit: 0n,
          endingDebit: 0n,
          endingCredit: 0n,
        },
        balanced: true,
      })),
    };

    ledgerMock = {
      accountBuckets: jest.fn().mockResolvedValue([
        { accountId: '10', costCenterId: '1', periodDebit: '500', periodCredit: '0' },
        { accountId: '20', costCenterId: '2', periodDebit: '500', periodCredit: '0' },
        { accountId: '20', costCenterId: null, periodDebit: '200', periodCredit: '200' },
      ]),
    };

    dimensionsMock = {
      list: jest.fn().mockResolvedValue([
        { id: 1, tenantId, kind: DimensionKind.COST_CENTER, code: 'CC1', name: 'مرکز ۱', parentId: null },
        { id: 2, tenantId, kind: DimensionKind.COST_CENTER, code: 'CC2', name: 'مرکز ۲', parentId: 1 },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostCentreReportService,
        { provide: FinancialReportsService, useValue: reportsMock },
        { provide: LedgerReportRepository, useValue: ledgerMock },
        { provide: DimensionRepository, useValue: dimensionsMock },
      ],
    }).compile();

    service = module.get<CostCentreReportService>(CostCentreReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('trialBalance - full report (unfiltered)', () => {
    it('returns trial balance sections for all cost centres plus unassigned lines', async () => {
      const result = await service.trialBalance(tenantId, {
        fiscalYearId: 1,
        columns: 6,
      });

      expect(reportsMock.resolvePeriod).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1, columns: 6 });
      expect(reportsMock.accounts).toHaveBeenCalledWith(tenantId);
      expect(ledgerMock.accountBuckets).toHaveBeenCalledWith(tenantId, expect.objectContaining({ byCostCenter: true }));
      expect(dimensionsMock.list).toHaveBeenCalledWith(tenantId, DimensionKind.COST_CENTER);

      expect(result.columns).toBe(6);
      expect(result.costCenterCode).toBeNull();
      expect(result.balanced).toBe(true);

      // Centres should include CC1, CC2, and unassigned
      expect(result.centres.length).toBeGreaterThanOrEqual(2);
      const unassigned = result.centres.find((c) => c.code === null);
      expect(unassigned).toBeDefined();
      expect(unassigned?.name).toBe(UNASSIGNED_CENTRE_NAME);
    });

    it('defaults columns to 6 if not provided', async () => {
      const result = await service.trialBalance(tenantId, {});
      expect(result.columns).toBe(6);
    });

    it('omits unassigned section when there are no lines without cost centre', async () => {
      ledgerMock.accountBuckets = jest.fn().mockResolvedValue([
        { accountId: '10', costCenterId: '1', periodDebit: '500', periodCredit: '0' },
      ]);

      const result = await service.trialBalance(tenantId, {});
      const unassigned = result.centres.find((c) => c.code === null);
      expect(unassigned).toBeUndefined();
    });
  });

  describe('trialBalance - filtered by costCenterCode', () => {
    it('returns filtered subtree and sets balanced to null', async () => {
      const result = await service.trialBalance(tenantId, {
        costCenterCode: 'CC2',
      });

      expect(result.costCenterCode).toBe('CC2');
      expect(result.balanced).toBeNull();

      // Filtered view should not append unassigned section
      const unassigned = result.centres.find((c) => c.code === null);
      expect(unassigned).toBeUndefined();
      expect(result.centres.some((c) => c.code === 'CC2')).toBe(true);
    });

    it('throws NotFoundException when costCenterCode does not exist', async () => {
      await expect(
        service.trialBalance(tenantId, {
          costCenterCode: 'NONEXISTENT',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
