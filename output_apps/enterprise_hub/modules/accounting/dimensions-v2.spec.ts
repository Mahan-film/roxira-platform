import { AccountLevel, AccountType, DimensionKind, ReportLine } from './enums/accounting.enum';
import { DimensionService, ValidatableLine } from './services/dimension.service';
import { DimensionRepository } from './repositories/dimension.repository';
import { DimensionRuleViolationException } from './exceptions/ledger.exceptions';
import { balanceSheet } from './reports/statements';
import { AccountBalance } from './reports/statements';

describe('Dimensions v2 Unit Suite (T181)', () => {
  describe('Dimension rule enforcement (validateLineRules)', () => {
    let mockRepo: Partial<DimensionRepository>;
    let service: DimensionService;

    beforeEach(() => {
      mockRepo = {
        listRules: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            tenantId: 'T1',
            name: 'Project required on CC-RND',
            active: true,
            accountType: null,
            accountCode: null,
            whenDimensionKind: 'COST_CENTER',
            whenDimensionCode: 'CC-RND',
            requiresDimensionKind: 'PROJECT',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'rule-2',
            tenantId: 'T1',
            name: 'CostCenter required on P&L',
            active: true,
            accountType: 'PL',
            accountCode: null,
            whenDimensionKind: null,
            whenDimensionCode: null,
            requiresDimensionKind: 'COST_CENTER',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      };
      service = new DimensionService(mockRepo as DimensionRepository);
    });

    it('rejects line with CC-RND when Project is missing (422 DIMENSION_RULE_VIOLATION)', async () => {
      const lines: ValidatableLine[] = [
        {
          accountCode: '5020',
          costCenterCode: 'CC-RND',
          projectCode: null,
        },
      ];
      const accountTypes = new Map([['5020', 'EXPENSE']]);

      await expect(service.validateLineRules('T1', lines, accountTypes)).rejects.toThrow(
        DimensionRuleViolationException,
      );

      try {
        await service.validateLineRules('T1', lines, accountTypes);
      } catch (err: any) {
        expect(err.getStatus()).toBe(422);
        expect(err.getResponse()).toMatchObject({
          code: 'DIMENSION_RULE_VIOLATION',
        });
      }
    });

    it('accepts line with CC-RND when Project is present', async () => {
      const lines: ValidatableLine[] = [
        {
          accountCode: '5020',
          costCenterCode: 'CC-RND',
          projectCode: 'PRJ-ALPHA',
        },
      ];
      const accountTypes = new Map([['5020', 'EXPENSE']]);

      await expect(service.validateLineRules('T1', lines, accountTypes)).resolves.not.toThrow();
    });

    it('rejects P&L account line when CostCenter is missing', async () => {
      const lines: ValidatableLine[] = [
        {
          accountCode: '5020',
          costCenterCode: null,
        },
      ];
      const accountTypes = new Map([['5020', 'EXPENSE']]);

      await expect(service.validateLineRules('T1', lines, accountTypes)).rejects.toThrow(
        DimensionRuleViolationException,
      );
    });

    it('accepts balance sheet account line even when CostCenter is missing', async () => {
      const lines: ValidatableLine[] = [
        {
          accountCode: '2010',
          costCenterCode: null,
        },
      ];
      const accountTypes = new Map([['2010', 'LIABILITY']]);

      await expect(service.validateLineRules('T1', lines, accountTypes)).resolves.not.toThrow();
    });
  });

  describe('Dimension renaming with effective dates', () => {
    let mockRepo: Partial<DimensionRepository>;
    let service: DimensionService;

    beforeEach(() => {
      mockRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 10,
          tenantId: 'T1',
          kind: DimensionKind.COST_CENTER,
          code: 'CC-SALES',
          name: 'Sales',
        }),
        closePreviousLabelHistory: jest.fn().mockResolvedValue(undefined),
        addLabelHistory: jest.fn().mockResolvedValue({} as any),
        updateDimension: jest.fn().mockImplementation((_tenant, _id, update) => ({
          id: 10,
          tenantId: 'T1',
          kind: DimensionKind.COST_CENTER,
          ...update,
        })),
        findByCode: jest.fn().mockResolvedValue({
          id: 10,
          tenantId: 'T1',
          kind: DimensionKind.COST_CENTER,
          code: 'CC-SALES',
          name: 'Sales',
        }),
      };
      service = new DimensionService(mockRepo as DimensionRepository);
    });

    it('records label history and closes prior open-ended record', async () => {
      await service.rename('T1', {
        from: 'CC-SALES',
        to: 'CC-EMEA-SALES',
        effective: '2026-11-01',
      });

      expect(mockRepo.closePreviousLabelHistory).toHaveBeenCalledWith('T1', 10, '2026-10-31');
      expect(mockRepo.addLabelHistory).toHaveBeenCalledWith('T1', {
        dimensionId: 10,
        code: 'CC-EMEA-SALES',
        name: 'CC-EMEA-SALES',
        effectiveFrom: '2026-11-01',
        effectiveTo: null,
      });
      expect(mockRepo.updateDimension).toHaveBeenCalledWith('T1', 10, {
        code: 'CC-EMEA-SALES',
        name: 'CC-EMEA-SALES',
      });
    });
  });

  describe('Balance sheet by dimension', () => {
    it('injects inter-dimension clearing line when filtered by dimension so check passes', () => {
      // Create unbalanced subset balances (e.g. only expenses of CC-RND: 600.00 EUR)
      const balances: AccountBalance[] = [
        {
          account: {
            id: 1,
            code: '5020',
            name: 'R&D Expense',
            accountType: AccountType.EXPENSE,
            level: AccountLevel.MOEIN,
            parentCode: '50',
            reportLine: ReportLine.COGS,
          },
          opening: 0n,
          priorDebit: 0n,
          priorCredit: 0n,
          periodDebit: 60000n, // 600.00
          periodCredit: 0n,
          closeDebit: 0n,
          closeCredit: 0n,
          inferred: false,
          line: ReportLine.COGS,
        },
      ];

      const sheet = balanceSheet(balances, { isDimensionFiltered: true });
      expect(sheet.checks.find((c) => c.key === 'balance_sheet')!.ok).toBe(true);
      expect(sheet.equity.lines.some((l) => l.line === 'INTER_DIMENSION_CLEARING')).toBe(true);
    });
  });
});
