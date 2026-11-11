import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Currency } from './enums/currency.enum';
import { CurrencyService } from './services/currency.service';
import { FxRevaluationService, ForeignAccountBalance } from './services/fx-revaluation.service';
import { CurrencyController } from './controllers/currency.controller';
import { ForeignAccountBalanceDto, RevalueBalancesDto } from './dto/revaluation.dto';
import { findTemplate, POSTING_TEMPLATES } from '../posting_rules/domain/posting-templates';
import { buildProposal } from '../posting_rules/domain/posting-engine';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';

describe('FX Revaluation / تسعیر ارز (#230 / T75)', () => {
  let currencyService: CurrencyService;
  let revaluationService: FxRevaluationService;
  let mockPostingRules: Partial<PostingRulesService>;
  let mockModuleRef: Partial<ModuleRef>;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string, defaultVal: string) => defaultVal),
    } as unknown as ConfigService;

    currencyService = new CurrencyService(configService);

    mockPostingRules = {
      post: jest.fn().mockResolvedValue({
        entryId: 42,
        entryNumber: 'V-1405-08-01',
        replayed: false,
      }),
    };

    mockModuleRef = {
      get: jest.fn((token: any) => {
        if (token === PostingRulesService) return mockPostingRules;
        return null;
      }) as any,
    };

    revaluationService = new FxRevaluationService(
      currencyService,
      mockModuleRef as ModuleRef,
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
        bookValueRialMinor: 8_500_000_000n,
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('gain');
      expect(result.currentValueRialMinor).toBe(9_200_000_000n);
      expect(result.gainMinor).toBe(700_000_000n);
      expect(result.lossMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(700_000_000n);
    });

    it('recognizes FX Loss on Asset when foreign currency depreciated', () => {
      const balance: ForeignAccountBalance = {
        accountCode: '1020',
        accountName: 'حساب دریافتنی ارزی یورو',
        currency: Currency.EUR,
        foreignAmountMinor: 500000n, // 5,000 EUR
        bookValueRialMinor: 5_500_000_000n,
      };

      const result = revaluationService.revalueBalance(balance);

      expect(result.type).toBe('loss');
      expect(result.currentValueRialMinor).toBe(5_000_000_000n);
      expect(result.lossMinor).toBe(500_000_000n);
      expect(result.gainMinor).toBe(0n);
      expect(result.diffRialMinor).toBe(-500_000_000n);
    });

    it('handles 3-decimal currencies like OMR with 1000n scale', () => {
      // OMR has 3 decimals (1000 baisa = 1 Rial Omani)
      // foreignAmountMinor: 10,000 baisa = 10 OMR
      // rate: 2,392,717 Rial/OMR
      const balance: ForeignAccountBalance = {
        accountCode: '1012',
        accountName: 'صندوق ریال عمان',
        currency: Currency.OMR,
        foreignAmountMinor: 10000n,
        bookValueRialMinor: 20_000_000n,
      };

      const result = revaluationService.revalueBalance(balance, 2_400_000n);
      // currentValue = (10000n * 2400000n) / 1000n = 24,000,000n
      expect(result.currentValueRialMinor).toBe(24_000_000n);
      expect(result.gainMinor).toBe(4_000_000n);
    });

    it('handles Liability (AP) balances correctly with inverted sign', () => {
      const apLiabilityIncreased: ForeignAccountBalance = {
        accountCode: '2010',
        accountName: 'حساب پرداختنی تجاری دلاری',
        currency: Currency.USD,
        foreignAmountMinor: 1000000n,
        bookValueRialMinor: 8_000_000_000n,
        isLiability: true,
      };

      const result = revaluationService.revalueBalance(apLiabilityIncreased);
      expect(result.type).toBe('loss');
      expect(result.lossMinor).toBe(1_200_000_000n);
      expect(result.gainMinor).toBe(0n);
    });
  });

  describe('Posting Rules Engine Integration', () => {
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

    it('posts through PostingRulesService with currency-scoped idempotency sourceId', async () => {
      const balances: ForeignAccountBalance[] = [
        {
          accountCode: '1012',
          accountName: 'بانک ارزی دلاری',
          currency: Currency.USD,
          foreignAmountMinor: 1000000n,
          bookValueRialMinor: 8_500_000_000n, // Gain: 700M
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
          amounts: { gain: 700_000_000n, loss: 0n },
          overrides: { monetary_asset: '1012' },
        }),
        undefined,
      );

      expect(res.postingResults).toHaveLength(1);
      expect(res.postingResults[0].entryId).toBe(42);
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
            foreignAmountMinor: '100000',
            bookValueRialMinor: '850000000',
            isLiability: false,
          },
        ],
      });

      const res = await controller.revalueMonthEnd(req, dto);
      expect(res.postingResults).toBeDefined();
      expect(mockPostingRules.post).toHaveBeenCalledWith(
        'tenant-jwt-123',
        expect.anything(),
        undefined,
      );
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
  });
});
