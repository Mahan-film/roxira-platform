import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CountryPackRegistry } from '../country-pack.registry';
import { createMalaysiaPack, MALAYSIA } from '../my/my.pack';
import { createIranPack } from '../ir/ir.pack';
import { createTestPack, TEST_COUNTRY } from '../xx/xx.pack';
import { buildProposal } from '../../posting_rules/domain/posting-engine';
import {
  drCrAmounts,
  settleRows,
} from '../../invoicing/services/invoice-voucher';
import {
  buildRailSettlementProposal,
  RailSettlementService,
  resolveRailConfig,
  validateSettlementAmounts,
} from './rail-settlement.service';
import { CreateRailSettlementDto } from './payment-rail.types';

describe('Payment Rail Clearing & Settlement (T156)', () => {
  const myPack = createMalaysiaPack();
  const irPack = createIranPack({ statutory: { list: async () => [], ratesFor: async () => ({} as never) } });
  const xxPack = createTestPack();

  const registry = new CountryPackRegistry('IR');
  registry.register(irPack);
  registry.register(myPack);

  const settlementService = new RailSettlementService(registry);

  describe('Payment Rail Configuration & Resolution', () => {
    it('resolves rails by ID or payment method in Malaysian pack', () => {
      expect(resolveRailConfig(myPack, 'card').id).toBe('card');
      expect(resolveRailConfig(myPack, 'CARD').clearingRole).toBe('clearing_card');
      expect(resolveRailConfig(myPack, 'VISA').defaultAccountCode).toBe('11310');

      expect(resolveRailConfig(myPack, 'duitnow').id).toBe('duitnow');
      expect(resolveRailConfig(myPack, 'DUITNOW_QR').clearingRole).toBe('clearing_duitnow');
      expect(resolveRailConfig(myPack, 'QR').defaultAccountCode).toBe('11320');

      expect(resolveRailConfig(myPack, 'ewallet').id).toBe('ewallet');
      expect(resolveRailConfig(myPack, 'TNG').defaultAccountCode).toBe('11330');
      expect(resolveRailConfig(myPack, 'GRABPAY').clearingRole).toBe('clearing_ewallet');

      expect(resolveRailConfig(myPack, 'shopee').id).toBe('shopee');
      expect(resolveRailConfig(myPack, 'SHOPEEPAY').defaultAccountCode).toBe('11340');

      expect(resolveRailConfig(myPack, 'tiktok').id).toBe('tiktok');
      expect(resolveRailConfig(myPack, 'TIKTOK_SHOP').defaultAccountCode).toBe('11350');

      expect(resolveRailConfig(myPack, 'grabfood').id).toBe('grabfood');
      expect(resolveRailConfig(myPack, 'GRAB').defaultAccountCode).toBe('11360');
    });

    it('resolves Iranian card rail to pos_clearing and account 1015', () => {
      const card = resolveRailConfig(irPack, 'CARD');
      expect(card.id).toBe('card');
      expect(card.clearingRole).toBe('pos_clearing');
      expect(card.defaultAccountCode).toBe('1015');
    });

    it('rejects unconfigured payment rail', () => {
      expect(() => resolveRailConfig(myPack, 'BITCOIN')).toThrow(BadRequestException);
      expect(() => resolveRailConfig(myPack, 'BITCOIN')).toThrow(/پیکربندی نشده است/);
    });
  });

  describe('Settlement Amounts Validation (Debits = Credits)', () => {
    it('accepts balanced settlement amounts where gross = net + fee + commission + sst', () => {
      const valid: CreateRailSettlementDto = {
        rail: 'card',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 10000n, // MYR 100.00
        netAmount: 9784n,    // MYR 97.84
        feeAmount: 200n,     // MYR 2.00
        commissionAmount: 0n,
        sstAmount: 16n,      // MYR 0.16 (8% SST on MYR 2.00 fee)
      };
      const res = validateSettlementAmounts(valid);
      expect(res.gross).toBe(10000n);
      expect(res.net).toBe(9784n);
      expect(res.fee).toBe(200n);
      expect(res.commission).toBe(0n);
      expect(res.sst).toBe(16n);
    });

    it('rejects unbalanced settlement amounts', () => {
      const unbalanced: CreateRailSettlementDto = {
        rail: 'card',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 10000n,
        netAmount: 9500n,
        feeAmount: 200n,
        // Missing 300 minor units
      };
      expect(() => validateSettlementAmounts(unbalanced)).toThrow(BadRequestException);
      expect(() => validateSettlementAmounts(unbalanced)).toThrow(/تراز نیست/);
    });

    it('rejects negative or zero gross and net amounts', () => {
      expect(() =>
        validateSettlementAmounts({
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '11200',
          grossAmount: 0n,
          netAmount: 0n,
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('Scenario 1: A Card Day (T156)', () => {
    it('posts card sales to card clearing account and settles daily card batch to bank with fee and SST', () => {
      // 1. Two card sales during the day
      // Sale 1: MYR 150.00 (15,000 minor units)
      // Sale 2: MYR 350.00 (35,000 minor units)
      // Total Gross = MYR 500.00 (50,000 minor units)
      const sale1Amounts = drCrAmounts(settleRows(true, [['CARD', 15000n]], 15000n));
      const sale1Proposal = buildProposal({
        docType: 'invoice.sale.settle_card_first',
        amounts: sale1Amounts,
        overrides: { pos_clearing: '11310', receivable: '12100' },
      });

      expect(sale1Proposal.lines).toEqual([
        {
          role: 'pos_clearing',
          accountCode: '11310',
          debit: 15000n,
          credit: 0n,
          description: 'دریافت از طریق پوز',
        },
        {
          role: 'receivable',
          accountCode: '12100',
          debit: 0n,
          credit: 15000n,
          description: 'تسویه حساب‌های دریافتنی',
        },
      ]);

      const sale2Amounts = drCrAmounts(settleRows(true, [['CARD', 35000n]], 35000n));
      const sale2Proposal = buildProposal({
        docType: 'invoice.sale.settle_card_first',
        amounts: sale2Amounts,
        overrides: { pos_clearing: '11310', receivable: '12100' },
      });
      expect(sale2Proposal.total).toBe(35000n);

      // Card clearing account accumulated debit = 15,000 + 35,000 = 50,000 minor units

      // 2. Daily Card Settlement Batch from Acquirer / Merchant Bank
      // Gross: MYR 500.00 (50,000 minor units)
      // Merchant Fee (MDR 1.5%): MYR 7.50 (750 minor units)
      // Platform Commission: MYR 2.50 (250 minor units)
      // SST on MDR and Commission (8% on MYR 10.00): MYR 0.80 (80 minor units)
      // Net deposited to Bank: MYR 489.20 (48,920 minor units)
      const settlementDto: CreateRailSettlementDto = {
        rail: 'card',
        date: '2026-11-16',
        bankAccountCode: '11200', // Cash at Bank - MYR
        grossAmount: 50000n,
        feeAmount: 750n,
        commissionAmount: 250n,
        sstAmount: 80n,
        netAmount: 48920n,
        reference: 'BATCH-CARD-20261116',
        overrides: {
          clearing_rail: '11310', // Card Clearing
          payment_fee: '62510',   // Payment Gateway & Card Merchant Fees
          platform_commission: '62520', // Marketplace & Platform Commissions
          vat_input: '12300',     // SST Input Tax
        },
      };

      const settlementProposal = buildRailSettlementProposal(myPack, settlementDto);

      expect(settlementProposal.total).toBe(50000n);
      expect(settlementProposal.lines).toHaveLength(5);

      expect(settlementProposal.lines).toEqual([
        {
          role: 'bank',
          accountCode: '11200',
          debit: 48920n,
          credit: 0n,
          description: 'واریز خالص تسویه به بانک',
        },
        {
          role: 'payment_fee',
          accountCode: '62510',
          debit: 750n,
          credit: 0n,
          description: 'کارمزد درگاه و تراکنش',
        },
        {
          role: 'platform_commission',
          accountCode: '62520',
          debit: 250n,
          credit: 0n,
          description: 'کمیسیون پلتفرم و بازارگاه',
        },
        {
          role: 'vat_input',
          accountCode: '12300',
          debit: 80n,
          credit: 0n,
          description: 'مالیات بر خدمات کارمزد و کمیسیون (SST)',
        },
        {
          role: 'clearing_rail',
          accountCode: '11310',
          debit: 0n,
          credit: 50000n,
          description: 'تسویه حساب واسط درگاه',
        },
      ]);

      // 3. Verification of Net Balance on Card Clearing (11310):
      // Debits (sales): 15,000 + 35,000 = 50,000
      // Credits (settlement): 50,000
      // Net Clearing Balance = 0!
      const totalClearingDebit = sale1Proposal.lines[0].debit + sale2Proposal.lines[0].debit;
      const totalClearingCredit = settlementProposal.lines[4].credit;
      expect(totalClearingDebit - totalClearingCredit).toBe(0n);
    });
  });

  describe('Scenario 2: A DuitNow Day (T156)', () => {
    it('routes DuitNow QR payments to 11320 and settles net to bank with transaction fee and SST', () => {
      // 1. DuitNow QR sales
      // Sale 1: MYR 80.00 (8,000 minor units)
      // Sale 2: MYR 120.00 (12,000 minor units)
      // Total Gross = MYR 200.00 (20,000 minor units)
      const sale1Amounts = drCrAmounts(settleRows(true, [['DUITNOW', 8000n]], 8000n));
      const sale1Proposal = buildProposal({
        docType: 'invoice.sale.settle',
        amounts: sale1Amounts,
        overrides: { clearing_duitnow: '11320', receivable: '12100' },
      });

      expect(sale1Proposal.lines).toEqual([
        {
          role: 'clearing_duitnow',
          accountCode: '11320',
          debit: 8000n,
          credit: 0n,
          description: 'دریافت از طریق دیت‌ناو / DuitNow QR',
        },
        {
          role: 'receivable',
          accountCode: '12100',
          debit: 0n,
          credit: 8000n,
          description: 'تسویه حساب‌های دریافتنی',
        },
      ]);

      const sale2Amounts = drCrAmounts(settleRows(true, [['DUITNOW_QR', 12000n]], 12000n));
      const sale2Proposal = buildProposal({
        docType: 'invoice.sale.settle',
        amounts: sale2Amounts,
        overrides: { clearing_duitnow: '11320', receivable: '12100' },
      });
      expect(sale2Proposal.total).toBe(12000n);

      // 2. DuitNow Daily Settlement
      // Gross: MYR 200.00 (20,000 minor units)
      // DuitNow MDR (0.5%): MYR 1.00 (100 minor units)
      // SST on Fee (8% of MYR 1.00): MYR 0.08 (8 minor units)
      // Net Payout: MYR 198.92 (19,892 minor units)
      const dto: CreateRailSettlementDto = {
        rail: 'duitnow',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 20000n,
        feeAmount: 100n,
        sstAmount: 8n,
        netAmount: 19892n,
        reference: 'DUITNOW-BATCH-20261116',
        overrides: {
          clearing_rail: '11320',
          payment_fee: '62510',
          vat_input: '12300',
        },
      };

      const proposal = buildRailSettlementProposal(myPack, dto);

      expect(proposal.total).toBe(20000n);
      // Zero commission line is omitted by the posting engine
      expect(proposal.lines).toEqual([
        {
          role: 'bank',
          accountCode: '11200',
          debit: 19892n,
          credit: 0n,
          description: 'واریز خالص تسویه به بانک',
        },
        {
          role: 'payment_fee',
          accountCode: '62510',
          debit: 100n,
          credit: 0n,
          description: 'کارمزد درگاه و تراکنش',
        },
        {
          role: 'vat_input',
          accountCode: '12300',
          debit: 8n,
          credit: 0n,
          description: 'مالیات بر خدمات کارمزد و کمیسیون (SST)',
        },
        {
          role: 'clearing_rail',
          accountCode: '11320',
          debit: 0n,
          credit: 20000n,
          description: 'تسویه حساب واسط درگاه',
        },
      ]);

      // Net balance on DuitNow clearing is 0
      const totalClearingDebit = sale1Proposal.lines[0].debit + sale2Proposal.lines[0].debit;
      expect(totalClearingDebit).toBe(proposal.lines[3].credit);
    });
  });

  describe('Scenario 3: Split Payment (T156)', () => {
    it('splits a payment across Cash, DuitNow QR and Card, routing each to its own account', () => {
      // Bill: MYR 250.00 (25,000 minor units)
      // Customer pays:
      //   Cash: MYR 50.00 (5,000 minor units)
      //   DuitNow QR: MYR 100.00 (10,000 minor units)
      //   Card: MYR 100.00 (10,000 minor units)
      const parts: ReadonlyArray<readonly [string, bigint]> = [
        ['CASH', 5000n],
        ['DUITNOW', 10000n],
        ['CARD', 10000n],
      ];
      const owed = 25000n;

      const amounts = drCrAmounts(settleRows(true, parts, owed));

      const proposal = buildProposal({
        docType: 'invoice.sale.settle',
        amounts,
        overrides: {
          cash: '11100',          // Petty Cash
          pos_clearing: '11310',  // Card Clearing
          clearing_duitnow: '11320', // DuitNow QR Clearing
          receivable: '12100',    // Trade Debtors
        },
      });

      expect(proposal.total).toBe(25000n);
      expect(proposal.lines).toEqual([
        {
          role: 'cash',
          accountCode: '11100',
          debit: 5000n,
          credit: 0n,
          description: 'دریافت نقدی/بانکی بابت صورتحساب',
        },
        {
          role: 'pos_clearing',
          accountCode: '11310',
          debit: 10000n,
          credit: 0n,
          description: 'دریافت از طریق پوز',
        },
        {
          role: 'clearing_duitnow',
          accountCode: '11320',
          debit: 10000n,
          credit: 0n,
          description: 'دریافت از طریق دیت‌ناو / DuitNow QR',
        },
        {
          role: 'receivable',
          accountCode: '12100',
          debit: 0n,
          credit: 25000n,
          description: 'تسویه حساب‌های دریافتنی',
        },
      ]);
    });
  });

  describe('Scenario 4: Refund & Settlement Netting (T156)', () => {
    it('reverses card clearing on customer refund and nets refund in daily settlement', () => {
      // 1. Original sale: Card MYR 100.00 (10,000 minor units)
      const saleAmounts = drCrAmounts(settleRows(true, [['CARD', 10000n]], 10000n));
      const saleProposal = buildProposal({
        docType: 'invoice.sale.settle_card_first',
        amounts: saleAmounts,
        overrides: { pos_clearing: '11310', receivable: '12100' },
      });
      expect(saleProposal.lines[0].debit).toBe(10000n);

      // 2. Customer refund: Return of item paid by Card (owed = -10,000n)
      const refundAmounts = drCrAmounts(settleRows(true, [['CARD', -10000n]], -10000n));
      const refundProposal = buildProposal({
        docType: 'invoice.sale.settle_card_first',
        amounts: refundAmounts,
        overrides: { pos_clearing: '11310', receivable: '12100' },
      });

      expect(refundProposal.total).toBe(10000n);
      // Notice: Card clearing is CREDITED, reversing the asset balance!
      expect(refundProposal.lines).toEqual([
        {
          role: 'receivable',
          accountCode: '12100',
          debit: 10000n,
          credit: 0n,
          description: 'تسویه حساب‌های دریافتنی',
        },
        {
          role: 'pos_clearing',
          accountCode: '11310',
          debit: 0n,
          credit: 10000n,
          description: 'دریافت از طریق پوز',
        },
      ]);

      // 3. Settlement Netting:
      // Suppose during the settlement cycle:
      // Gross sales = MYR 300.00 (30,000 minor units)
      // Refund = MYR 100.00 (10,000 minor units)
      // Net cleared from card clearing = MYR 200.00 (20,000 minor units)
      // MDR Fee on gross sales = MYR 4.50 (450 minor units)
      // SST on Fee = MYR 0.36 (36 minor units)
      // Net Bank Payout = MYR 195.14 (19,514 minor units)
      const dto: CreateRailSettlementDto = {
        rail: 'card',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 20000n, // Net cleared from rail after refund
        feeAmount: 450n,
        sstAmount: 36n,
        netAmount: 19514n,
        reference: 'SETTLE-NET-REFUND-001',
        overrides: {
          clearing_rail: '11310',
          payment_fee: '62510',
          vat_input: '12300',
        },
      };

      const settlementProposal = buildRailSettlementProposal(myPack, dto);
      expect(settlementProposal.total).toBe(20000n);
      expect(settlementProposal.lines[0].debit).toBe(19514n); // Bank
      expect(settlementProposal.lines[1].debit).toBe(450n);   // Fee
      expect(settlementProposal.lines[2].debit).toBe(36n);    // SST
      expect(settlementProposal.lines[3].credit).toBe(20000n); // Card clearing
    });
  });

  describe('Scenario 5: Marketplace Settlement (Shopee / GrabFood) (T156 & T157 Seam)', () => {
    it('creates settlement entry for marketplace payouts with commission, fees, and SST', () => {
      // Shopee Weekly Payout:
      // Gross Orders: MYR 1,000.00 (100,000 minor units)
      // Shopee Commission (4%): MYR 40.00 (4,000 minor units)
      // Payment Processing Fee (2%): MYR 20.00 (2,000 minor units)
      // SST on Services (8% on MYR 60.00): MYR 4.80 (480 minor units)
      // Net Payout to Bank: MYR 935.20 (93,520 minor units)
      const shopeeDto: CreateRailSettlementDto = {
        rail: 'shopee',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 100000n,
        feeAmount: 2000n,
        commissionAmount: 4000n,
        sstAmount: 480n,
        netAmount: 93520n,
        reference: 'SHOPEE-PAYOUT-MY-2026W46',
        overrides: {
          clearing_rail: '11340',        // Marketplace Clearing - Shopee
          payment_fee: '62510',          // Payment Gateway & Card Merchant Fees
          platform_commission: '62520',  // Marketplace & Platform Commissions
          vat_input: '12300',            // SST Input Tax
        },
      };

      const preview = settlementService.previewSettlement(MALAYSIA, shopeeDto);

      expect(preview.rail.id).toBe('shopee');
      expect(preview.amounts.gross).toBe(100000n);
      expect(preview.amounts.net).toBe(93520n);
      expect(preview.proposal.total).toBe(100000n);

      expect(preview.proposal.lines).toEqual([
        {
          role: 'bank',
          accountCode: '11200',
          debit: 93520n,
          credit: 0n,
          description: 'واریز خالص تسویه به بانک',
        },
        {
          role: 'payment_fee',
          accountCode: '62510',
          debit: 2000n,
          credit: 0n,
          description: 'کارمزد درگاه و تراکنش',
        },
        {
          role: 'platform_commission',
          accountCode: '62520',
          debit: 4000n,
          credit: 0n,
          description: 'کمیسیون پلتفرم و بازارگاه',
        },
        {
          role: 'vat_input',
          accountCode: '12300',
          debit: 480n,
          credit: 0n,
          description: 'مالیات بر خدمات کارمزد و کمیسیون (SST)',
        },
        {
          role: 'clearing_rail',
          accountCode: '11340',
          debit: 0n,
          credit: 100000n,
          description: 'تسویه حساب واسط درگاه',
        },
      ]);
    });

    it('resolves MY chart accounts (62510, 62520, 12300) without overrides and reads rail feeRole', () => {
      const myNoOverrides = settlementService.previewSettlement(MALAYSIA, {
        rail: 'shopee',
        date: '2026-11-16',
        bankAccountCode: '11200',
        grossAmount: 100000n,
        feeAmount: 2000n,
        commissionAmount: 4000n,
        sstAmount: 480n,
        netAmount: 93520n,
        reference: 'SHOPEE-NO-OVERRIDES',
      });
      const codesByRole = Object.fromEntries(myNoOverrides.proposal.lines.map((l) => [l.role, l.accountCode]));
      expect(codesByRole).toEqual({
        bank: '11200',
        payment_fee: '62510',
        platform_commission: '62520',
        vat_input: '12300',
        clearing_rail: '11340',
      });

      const irWithTenantBankFee = settlementService.previewSettlement(
        'IR',
        {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '1012',
          grossAmount: 100000n,
          feeAmount: 1000n,
          netAmount: 99000n,
          reference: 'IR-BANK-FEE-ROLE',
        },
        { bank_fee: '5299' },
      );
      const irFeeLine = irWithTenantBankFee.proposal.lines.find((l) => l.role === 'payment_fee');
      expect(irFeeLine?.accountCode).toBe('5299');
    });

    it('requires reference or idempotencyKey in settleRail', async () => {
      const mockPostingRules = { post: jest.fn(), describe: jest.fn(async () => []) } as never;
      const svc = new RailSettlementService(registry, mockPostingRules);
      await expect(
        svc.settleRail('tenant-1', MALAYSIA, {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '11200',
          grossAmount: 10000n,
          netAmount: 10000n,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bankAccountCode that is not in pack chart or tenant mapping', () => {
      expect(() =>
        settlementService.previewSettlement(MALAYSIA, {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '99999-INVALID',
          grossAmount: 10000n,
          netAmount: 10000n,
          reference: 'BAD-BANK',
        }),
      ).toThrow(BadRequestException);

      const withTenantBank = settlementService.previewSettlement(
        MALAYSIA,
        {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '11299-TENANT',
          grossAmount: 10000n,
          netAmount: 10000n,
          reference: 'TENANT-BANK',
        },
        { bank: '11299-TENANT' },
      );
      expect(withTenantBank.proposal.lines.find((l) => l.role === 'bank')?.accountCode).toBe('11299-TENANT');
    });

    it('rejects mismatched idempotencyKey and reference in settleRail', async () => {
      const mockPostingRules = {
        post: jest.fn(),
        describe: jest.fn(async () => []),
      } as never;
      const svc = new RailSettlementService(registry, mockPostingRules);
      await expect(
        svc.settleRail('tenant-1', MALAYSIA, {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '11200',
          grossAmount: 10000n,
          netAmount: 10000n,
          idempotencyKey: 'idem-123',
          reference: 'ref-456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when PostingRulesService.describe is missing or returns invalid shape in settleRail', async () => {
      const missingDescribe = new RailSettlementService(registry, { post: jest.fn() } as never);
      await expect(
        missingDescribe.settleRail('tenant-1', MALAYSIA, {
          rail: 'card',
          date: '2026-11-16',
          bankAccountCode: '11200',
          grossAmount: 10000n,
          netAmount: 10000n,
          idempotencyKey: 'idem-123',
        }),
      ).rejects.toThrow(/describe/);
    });
  });
});
