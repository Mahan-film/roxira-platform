import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef, Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_ACTION_KEY, ACCESS_MODULE_KEY } from '../access/decorators';
import { AccessAction, AccessModule } from '../access/catalogue';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { AccountLevel, AccountType } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { buildProposal } from '../posting_rules/domain/posting-engine';
import { findTemplate, POSTING_TEMPLATES } from '../posting_rules/domain/posting-templates';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { CurrencyController } from './controllers/currency.controller';
import { ForeignAccountBalanceDto, RevalueBalancesDto } from './dto/revaluation.dto';
import { Currency } from './enums/currency.enum';
import { CurrencyService } from './services/currency.service';
import { TenantScope } from '../access/services/tenant-scope';
import {
  ForeignAccountBalance,
  FxRevaluationService,
} from './services/fx-revaluation.service';

describe('FX Revaluation / تسعیر ارز (#230 / T75)', () => {
  let currencyService: CurrencyService;
  let revaluationService: FxRevaluationService;
  let mockPostingRules: Partial<PostingRulesService>;
  let mockAccounting: Partial<AccountingService>;
  let mockModuleRef: Partial<ModuleRef>;
  let mockScope: TenantScope;

  const defaultAccounts = [
    {
      id: 1,
      code: '1012',
      name: 'حساب جاری ارزی دلاری',
      accountType: AccountType.ASSET,
      level: AccountLevel.MOEIN,
      currency: Currency.USD,
      balance: '8500000000.00', // 8,500,000,000 Rials = 850,000,000,000 minor
    },
    {
      id: 2,
      code: '1020',
      name: 'حساب دریافتنی ارزی یورو',
      accountType: AccountType.ASSET,
      level: AccountLevel.MOEIN,
      currency: Currency.EUR,
      balance: '5500000000.00', // 5,500,000,000 Rials = 550,000,000,000 minor
    },
    {
      id: 3,
      code: '2010',
      name: 'حساب پرداختنی تجاری دلاری',
      accountType: AccountType.LIABILITY,
      level: AccountLevel.MOEIN,
      currency: Currency.USD,
      balance: '-8000000000.00', // credit-nature AP: debit-positive ledger stores it negative (8B Rial = 800,000,000,000 minor)
    },
    {
      id: 4,
      code: '4010',
      name: 'فروش',
      accountType: AccountType.REVENUE,
      level: AccountLevel.MOEIN,
      currency: Currency.USD,
      balance: 0,
    },
    {
      id: 5,
      code: '5010',
      name: 'بهای تمام‌شده',
      accountType: AccountType.EXPENSE,
      level: AccountLevel.MOEIN,
      currency: Currency.USD,
      balance: 0,
    },
    {
      id: 6,
      code: '1000',
      name: 'دارایی‌های جاری',
      accountType: AccountType.ASSET,
      level: AccountLevel.KOL,
      currency: Currency.IRR,
      balance: 0,
    },
  ];

  beforeEach(() => {
    const configService = {
      get: jest.fn((_key: string, defaultVal: string) => defaultVal),
    } as unknown as ConfigService;

    currencyService = new CurrencyService(configService);

    mockPostingRules = {
      findSource: jest.fn().mockResolvedValue(null),
      post: jest.fn().mockResolvedValue({
        entryId: 42,
        entryNumber: 'V-1405-08-01',
        replayed: false,
      }),
      describe: jest.fn().mockResolvedValue([
        {
          docType: 'currency.fx_revaluation',
          title: 'تسعیر ارز',
          roles: [
            { role: 'fx_gain', accountCode: '4120' },
            { role: 'fx_loss', accountCode: '5210' },
          ],
        },
      ]),
    };

    mockAccounting = {
      listAccounts: jest.fn().mockResolvedValue(defaultAccounts),
      findOneJournalEntry: jest.fn().mockResolvedValue({
        id: 42,
        entryNumber: 'V-1405-08-01',
        description: 'سند تسعیر ارز پایان دوره 1405-08 - بانک ارزی دلاری (USD) [نرخ: 920000 ریال] [fp:mocked-fingerprint]',
      }),
    };

    mockModuleRef = {
      get: jest.fn((token: any) => {
        if (token === PostingRulesService) return mockPostingRules;
        if (token === AccountingService) return mockAccounting;
        return null;
      }) as any,
    };

    mockScope = {
      run: jest.fn(async (_t, work) => work({} as any)),
      within: jest.fn(async (_t, _o, work) => work({} as any)),
    } as unknown as TenantScope;

    revaluationService = new FxRevaluationService(
      currencyService,
      mockModuleRef as ModuleRef,
      mockScope,
    );
  });

  describe('Exchange Rate to Rial Calculations', () => {
    it('returns 1 for IRR and 10 for IRT', () => {
      expect(revaluationService.getRateToRial(Currency.IRR)).toBe(1n);
      expect(revaluationService.getRateToRial(Currency.IRT)).toBe(10n);
    });

    it('calculates USD to Rial rate from reference table', () => {
      // Default rates: USD = 1, IRR = 920,000 per USD => 1 USD = 920,000 Rials
      const rate = revaluationService.getRateToRial(Currency.USD);
      expect(rate).toBe(920000n);
    });

    it('calculates EUR to Rial rate accurately without float maths', () => {
      // EUR = 0.92 per USD, IRR = 920,000 per USD => 1 EUR = 920,000 / 0.92 = 1,000,000 Rials
      const rate = revaluationService.getRateToRial(Currency.EUR);
      expect(rate).toBe(1000000n);
    });
  });

  describe('Single Balance Revaluation (Assets & Liabilities)', () => {
    it('recognizes FX Gain on Asset when foreign currency appreciated against Rial', () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'حساب جاری ارزی دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n, // 10,000 USD
        bookValueRialMinor: 850_000_000_000n, // 8.5 billion Rials in minor units
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('gain');
      expect(result.currentValueRialMinor).toBe(920_000_000_000n);
      expect(result.gainMinor).toBe(70_000_000_000n);
      expect(result.lossMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(70_000_000_000n);
    });

    it('recognizes FX Loss on Asset when foreign currency depreciated', () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1020',
        accountName: 'حساب دریافتنی ارزی یورو',
        currency: Currency.EUR,
        foreignAmountMinor: 500000n, // 5,000 EUR
        bookValueRialMinor: 550_000_000_000n, // 5.5 billion Rials in minor units
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('loss');
      expect(result.currentValueRialMinor).toBe(500_000_000_000n);
      expect(result.lossMinor).toBe(50_000_000_000n);
      expect(result.gainMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(-50_000_000_000n);
    });

    it('handles 3-decimal currencies like OMR with 1000n scale', () => {
      // OMR has 3 decimals (1000 baisa = 1 Rial Omani)
      // foreignAmountMinor: 10,000 baisa = 10 OMR
      // custom rate: 2,400,000 Rial/OMR
      // currentValue = 10 * 2,400,000 Rial = 24,000,000 Rials = 2,400,000,000 minor
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'صندوق ریال عمان',
        currency: Currency.OMR,
        foreignAmountMinor: 10000n,
        bookValueRialMinor: 2_000_000_000n, // 20 million Rials in minor units
      };

      const result = revaluationService.revalueBalance(balance, 2_400_000n);
      expect(result.currentValueRialMinor).toBe(2_400_000_000n);
      expect(result.gainMinor).toBe(400_000_000n);
    });

    it('handles Liability (AP) balances correctly with inverted sign', () => {
      const apLiabilityIncreased: ForeignAccountBalance = {
        accountCode: '2010',
        accountName: 'حساب پرداختنی تجاری دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n, // 10,000 USD
        bookValueRialMinor: 800_000_000_000n, // 8.0 billion Rials in minor units
        isLiability: true,
      };

      const result = revaluationService.revalueBalance(apLiabilityIncreased);
      expect(result.type).toBe('loss');
      expect(result.lossMinor).toBe(120_000_000_000n);
      expect(result.gainMinor).toBe(0n);
    });
  });

  describe('Posting Rules Engine Integration & Template Validation', () => {
    it('currency.fx_revaluation template exists with balanced posting rules', () => {
      const tpl = findTemplate('currency.fx_revaluation');
      expect(tpl).toBeDefined();
      expect(tpl?.docType).toBe('currency.fx_revaluation');
      expect(tpl?.amounts).toEqual(['gain', 'loss']);

      const proposal = buildProposal({
        docType: 'currency.fx_revaluation',
        amounts: {
          gain: 300_000_000n,
          loss: 0n,
        },
        mapping: {},
        overrides: {
          monetary_asset: '1012',
        },
      });

      expect(proposal.total).toBe(300_000_000n);
      expect(proposal.lines).toHaveLength(2);
      expect(proposal.lines[0].accountCode).toBe('1012');
      expect(proposal.lines[0].debit).toBe(300_000_000n);
      expect(proposal.lines[1].accountCode).toBe('4120');
      expect(proposal.lines[1].credit).toBe(300_000_000n);
    });

    it('posts through PostingRulesService with currency-scoped idempotency sourceId and audit rate', async () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012',
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 850_000_000_000n, // Gain: 70B minor (700M Rial)
        },
      ];

      const res = await revaluationService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances,
      });

      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          docType: 'currency.fx_revaluation',
          sourceType: 'currency_revaluation',
          sourceId: '1405-08:1012:USD',
          date: '2026-11-21',
          amounts: { gain: 70_000_000_000n, loss: 0n },
          overrides: { monetary_asset: '1012' },
          description: expect.stringContaining('[نرخ: 920000 ریال]'),
        }),
        expect.anything(),
      );

      expect(res.postingResults).toHaveLength(1);
      expect(res.postingResults[0].entryId).toBe(42);
    });
  });

  describe('Account Type Verification & Reconciliation (Blocker 1)', () => {
    it('rejects unknown accounts not present in chart of accounts', async () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '9999',
          accountName: 'حساب ناموجود',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 80000000n,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects header accounts (KOL or GROUP)', async () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1000',
          accountName: 'دارایی‌های جاری (کل)',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 80000000n,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects revenue and expense accounts passed as monetary asset/liability', async () => {
      const revenueBalance: ForeignAccountBalance[] = [
        {
          accountCode: '4010', // REVENUE with USD currency
          accountName: 'فروش ارزی',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 0n,
          isLiability: false,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: revenueBalance,
        }),
      ).rejects.toThrow('حساب دارایی ارزی «4010» باید دارای ماهیت دارایی (ASSET) باشد');

      const expenseBalance: ForeignAccountBalance[] = [
        {
          accountCode: '5010', // EXPENSE with USD currency
          accountName: 'هزینه ارزی',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 0n,
          isLiability: true,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: expenseBalance,
        }),
      ).rejects.toThrow('حساب بدهی ارزی «5010» باید دارای ماهیت بدهی (LIABILITY) باشد');
    });

    it('rejects asset account declared as liability, and liability account declared as asset', async () => {
      // 1012 is ASSET, but declared as liability
      const assetAsLiability: ForeignAccountBalance[] = [
        {
          accountCode: '1012',
          accountName: 'بانک ارزی',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 850000000000n,
          isLiability: true, // wrong!
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: assetAsLiability,
        }),
      ).rejects.toThrow('باید دارای ماهیت بدهی (LIABILITY) باشد، اما ماهیت آن «ASSET» است');

      // 2010 is LIABILITY, but declared as asset
      const liabilityAsAsset: ForeignAccountBalance[] = [
        {
          accountCode: '2010',
          accountName: 'تسهیلات ارزی',
          currency: Currency.USD,
          foreignAmountMinor: 100000n,
          bookValueRialMinor: 800000000000n,
          isLiability: false, // wrong!
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: liabilityAsAsset,
        }),
      ).rejects.toThrow('باید دارای ماهیت دارایی (ASSET) باشد، اما ماهیت آن «LIABILITY» است');
    });

    it('rejects bookValueRialMinor that contradicts non-zero ledger balance', async () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012', // ledger balance is 8,500,000,000n
          accountName: 'بانک دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 9_999_999_999n, // Contradicts ledger balance!
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects currency mismatch between account definition and balance input', async () => {
      const accountsWithCurrency = [
        ...defaultAccounts,
        {
          code: '1013',
          name: 'بانک ارزی یورو',
          level: AccountLevel.MOEIN,
          accountType: AccountType.ASSET,
          balance: 0,
          currency: Currency.EUR,
        },
      ];
      (mockAccounting.listAccounts as jest.Mock).mockResolvedValue(accountsWithCurrency);

      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1013',
          accountName: 'بانک ارزی یورو',
          currency: Currency.USD, // Mismatched currency!
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 0n,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects revaluation or non-zero book value when account has zero ledger balance', async () => {
      const accountsWithZero = [
        ...defaultAccounts,
        {
          code: '1014',
          name: 'بانک ارزی ین ژاپن',
          level: AccountLevel.MOEIN,
          accountType: AccountType.ASSET,
          balance: 0,
          currency: Currency.USD,
        },
      ];
      (mockAccounting.listAccounts as jest.Mock).mockResolvedValue(accountsWithZero);

      // Attempting to post arbitrary gain/loss on a zero-balance account
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1014',
          accountName: 'بانک ارزی ین ژاپن',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n, // non-zero foreign amount!
          bookValueRialMinor: 0n,
        },
      ];

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves customized tenant posting roles for fx_gain and fx_loss in voucher plan', async () => {
      (mockPostingRules.describe as jest.Mock).mockResolvedValueOnce([
        {
          docType: 'currency.fx_revaluation',
          title: 'تسعیر ارز',
          roles: [
            { role: 'fx_gain', accountCode: '4199' }, // Custom mapped gain account
            { role: 'fx_loss', accountCode: '5299' }, // Custom mapped loss account
          ],
        },
      ]);

      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012',
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 850_000_000_000n, // Gain: 70B minor
        },
      ];

      const res = await revaluationService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances,
      });

      // Assert plan uses the tenant's custom resolved accounts
      expect(res.plan.voucherLines.some((l) => l.accountCode === '4199')).toBe(true);
      expect(res.plan.voucherLines.some((l) => l.accountCode === '4120')).toBe(false);
    });
  });

  describe('Credit-nature (AP) reconcile uses the account normal side', () => {
    const ap = (bookValueRialMinor: bigint): ForeignAccountBalance => ({
      accountCode: '2010',
      accountName: 'حساب پرداختنی تجاری دلاری',
      currency: Currency.USD,
      foreignAmountMinor: 1_000_000n, // 10,000 USD
      bookValueRialMinor,
      isLiability: true,
    });

    it('AP in USD with rate up posts an FX LOSS voucher against the negative ledger balance', async () => {
      await revaluationService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances: [ap(800_000_000_000n)],
        rates: { [Currency.USD]: 920000n },
      });
      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          sourceId: '1405-08:2010:USD',
          amounts: { gain: 0n, loss: 120_000_000_000n },
          overrides: { monetary_asset: '2010' },
        }),
        expect.anything(),
      );
    });

    it('AP in USD with rate down posts an FX GAIN voucher', async () => {
      await revaluationService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances: [ap(800_000_000_000n)],
        rates: { [Currency.USD]: 780000n },
      });
      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ amounts: { gain: 20_000_000_000n, loss: 0n } }),
        expect.anything(),
      );
    });

    it('rejects an AP book value that does not match the ledger (including the wrong-sign value)', async () => {
      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: [ap(799_999_999_999n)],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPostingRules.post).not.toHaveBeenCalled();
    });

    it('rejects a zero-balance account when the client sends a non-zero book value', async () => {
      (mockAccounting.listAccounts as jest.Mock).mockResolvedValue([
        ...defaultAccounts,
        {
          code: '2011',
          name: 'پرداختنی صفر',
          level: AccountLevel.MOEIN,
          accountType: AccountType.LIABILITY,
          balance: '0.00',
          currency: Currency.USD,
        },
      ]);
      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: [{ ...ap(800_000_000_000n), accountCode: '2011' }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPostingRules.post).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency & Conflict Safety (Blocker 2 / Lesson 18)', () => {
    it('returns existing voucher with replayed: true on identical rerun', async () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'بانک دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n,
        bookValueRialMinor: 850_000_000_000n,
      };

      const itemResult = revaluationService.revalueBalance(balance);

      // Existing source found in repository
      (mockPostingRules.findSource as jest.Mock).mockResolvedValue({
        id: 10,
        entryId: 99,
        entryNumber: 'V-1405-08-EXISTING',
      });

      // Existing entry in ledger has matching fingerprint tag
      (mockAccounting.findOneJournalEntry as jest.Mock).mockResolvedValue({
        id: 99,
        entryNumber: 'V-1405-08-EXISTING',
        description: `سند تسعیر ارز پایان دوره 1405-08 - بانک دلاری (USD) [نرخ: 920000 ریال] [fp:${itemResult.fingerprint}]`,
      });

      const res = await revaluationService.postMonthEndRevaluation('tenant-1', {
        period: '1405-08',
        date: '2026-11-21',
        balances: [balance],
      });

      expect(res.postingResults).toEqual([
        {
          entryId: 99,
          entryNumber: 'V-1405-08-EXISTING',
          replayed: true,
        },
      ]);
      expect(mockPostingRules.post).not.toHaveBeenCalled();
    });

    it('throws HTTP 409 ConflictException when same period and currency is rerun with different parameters', async () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'بانک دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n,
        bookValueRialMinor: 850_000_000_000n,
      };

      // Existing source found in repository
      (mockPostingRules.findSource as jest.Mock).mockResolvedValue({
        id: 10,
        entryId: 99,
        entryNumber: 'V-1405-08-EXISTING',
      });

      // Existing entry in ledger has a DIFFERENT fingerprint tag (different amount/rate previously posted)
      (mockAccounting.findOneJournalEntry as jest.Mock).mockResolvedValue({
        id: 99,
        entryNumber: 'V-1405-08-EXISTING',
        description: `سند تسعیر ارز پایان دوره 1405-08 - بانک دلاری (USD) [نرخ: 920000 ریال] [fp:other_fp_hash_1234]`,
      });

      await expect(
        revaluationService.postMonthEndRevaluation('tenant-1', {
          period: '1405-08',
          date: '2026-11-21',
          balances: [balance],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('CurrencyController & DTO Validation', () => {
    it('controller extracts tenantId from authenticated JWT and delegates to service', async () => {
      const controller = new CurrencyController(currencyService, revaluationService);
      const req = {
        user: { sub: 'u1', tenantId: 'tenant-jwt-123', tenantRole: 'OWNER' },
      } as unknown as AuthenticatedRequest;

      const dto = plainToInstance(RevalueBalancesDto, {
        period: '1405-08',
        date: '2026-11-21',
        balances: [
          {
            accountCode: '1012',
            accountName: 'بانک دلاری',
            currency: Currency.USD,
            foreignAmountMinor: '1000000',
            bookValueRialMinor: '850000000000',
            isLiability: false,
          },
        ],
      });

      const res = await controller.revalueMonthEnd(req, dto);
      expect(res.postingResults).toBeDefined();
      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-jwt-123',
        expect.anything(),
        expect.anything(),
      );
    });

    it('controller response is JSON-serialisable (no raw bigint) with minor amounts as strings', async () => {
      const controller = new CurrencyController(currencyService, revaluationService);
      const dto = plainToInstance(RevalueBalancesDto, {
        period: '1405-08',
        date: '2026-11-21',
        balances: [
          {
            accountCode: '1012',
            accountName: 'بانک ارزی دلاری',
            currency: Currency.USD,
            foreignAmountMinor: '1000000',
            bookValueRialMinor: '850000000000',
          },
        ],
      });
      const res: any = await controller.revalueMonthEnd(
        { user: { tenantId: 'tenant-1' } } as unknown as AuthenticatedRequest,
        dto,
      );
      expect(() => JSON.stringify(res)).not.toThrow();
      expect(res.plan.totalGainMinor).toBe('70000000000');
      expect(res.plan.items[0].foreignAmountMinor).toBe('1000000');
    });

    it('enforces @ModuleAccess(AccessModule.ACCOUNTING) and @RequireAction(AccessAction.POST)', () => {
      const reflector = new Reflector();
      const moduleAccess = reflector.get(
        ACCESS_MODULE_KEY,
        CurrencyController.prototype.revalueMonthEnd,
      );
      const requiredAction = reflector.get(
        ACCESS_ACTION_KEY,
        CurrencyController.prototype.revalueMonthEnd,
      );

      expect(moduleAccess).toBe(AccessModule.ACCOUNTING);
      expect(requiredAction).toBe(AccessAction.POST);
    });

    it('rejects invalid period format and non-numeric minor amounts', async () => {
      const badDto = plainToInstance(RevalueBalancesDto, {
        period: 'invalid-period',
        date: 'not-a-date',
        balances: [
          {
            accountCode: '!',
            accountName: 'Bank',
            currency: Currency.USD,
            foreignAmountMinor: '-500',
            bookValueRialMinor: 'abc',
          },
        ],
      });

      const errors = await validate(badDto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'period')).toBe(true);
      expect(errors.some((e) => e.property === 'date')).toBe(true);
    });

    it('rejects month out of range 01-12 in period and day out of range in date', async () => {
      const badDatesDto = plainToInstance(RevalueBalancesDto, {
        period: '1405-13', // Month 13 is invalid
        date: '2026-99-99', // Invalid month and day
        balances: [
          {
            accountCode: '1012',
            accountName: 'بانک دلاری',
            currency: Currency.USD,
            foreignAmountMinor: '100000',
            bookValueRialMinor: '850000000',
          },
        ],
      });

      const errors = await validate(badDatesDto);
      expect(errors.some((e) => e.property === 'period')).toBe(true);
      expect(errors.some((e) => e.property === 'date')).toBe(true);
    });

    it('rejects amount strings exceeding 18 digits or with non-digits', async () => {
      const overflowDto = plainToInstance(ForeignAccountBalanceDto, {
        accountCode: '1012',
        accountName: 'بانک دلاری',
        currency: Currency.USD,
        foreignAmountMinor: '1'.repeat(19), // 19 digits > 18
        bookValueRialMinor: '5000000',
      });

      const errors = await validate(overflowDto);
      expect(errors.some((e) => e.property === 'foreignAmountMinor')).toBe(true);
    });

    it('rejects duplicate (accountCode, currency) rows in balances', async () => {
      const dupDto = plainToInstance(RevalueBalancesDto, {
        period: '1405-08',
        date: '2026-11-21',
        balances: [
          {
            accountCode: '1012',
            accountName: 'بانک دلاری 1',
            currency: Currency.USD,
            foreignAmountMinor: '1000',
            bookValueRialMinor: '10000',
          },
          {
            accountCode: '1012',
            accountName: 'بانک دلاری 2',
            currency: Currency.USD, // Duplicate (1012, USD)
            foreignAmountMinor: '2000',
            bookValueRialMinor: '20000',
          },
        ],
      });

      const errors = await validate(dupDto);
      expect(errors.some((e) => e.property === 'balances')).toBe(true);
    });

    it('rejects invalid currency keys or non-numeric/zero rates in rates map', async () => {
      const badRatesDto = plainToInstance(RevalueBalancesDto, {
        period: '1405-08',
        date: '2026-11-21',
        rates: {
          INVALID_CURR: '1000',
          USD: '0', // zero is invalid
        },
        balances: [
          {
            accountCode: '1012',
            accountName: 'بانک دلاری',
            currency: Currency.USD,
            foreignAmountMinor: '1000',
            bookValueRialMinor: '10000',
          },
        ],
      });

      const errors = await validate(badRatesDto);
      expect(errors.some((e) => e.property === 'rates')).toBe(true);
    });
  });
});
