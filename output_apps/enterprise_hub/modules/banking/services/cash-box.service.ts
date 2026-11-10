import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { fromMinor, minorToDecimal, toMinor } from '../../accounting/money';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { CashBankTransferDto, CreateCashBoxDto, PosSettlementDto } from '../dto/cash-box.dto';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { CashBoxEntity } from '../entities/cash-box.entity';
import { PosSettlementEntity } from '../entities/pos-settlement.entity';

@Injectable()
export class CashBoxService {
  constructor(
    private readonly scope: TenantScope,
    private readonly postingRules: PostingRulesService,
  ) {}

  async createCashBox(
    tenantId: string,
    dto: CreateCashBoxDto,
    manager?: EntityManager,
  ): Promise<CashBoxEntity> {
    return this.scope.within(tenantId, manager, async (m) => {
      // Validate ledger account belongs to tenant
      const account = await m.findOne(ChartOfAccountEntity, {
        where: { id: dto.ledgerAccountId, tenantId },
      });
      if (!account) {
        throw new NotFoundException(`حساب دفتر کل با شناسه ${dto.ledgerAccountId} یافت نشد.`);
      }

      const openingMinor = dto.openingBalance != null ? toMinor(dto.openingBalance) : 0n;
      const box = m.create(CashBoxEntity, {
        tenantId,
        name: dto.name.trim(),
        code: dto.code.trim(),
        ledgerAccountId: dto.ledgerAccountId,
        currency: dto.currency ?? 'IRR',
        openingBalance: minorToDecimal(openingMinor),
        active: true,
      });

      return m.save(CashBoxEntity, box);
    });
  }

  async listCashBoxes(tenantId: string, manager?: EntityManager) {
    return this.scope.within(tenantId, manager, async (m) => {
      const boxes = await m.find(CashBoxEntity, {
        where: { tenantId },
        order: { code: 'ASC' },
      });
      if (boxes.length === 0) return [];
      const accountIds = boxes.map((b) => b.ledgerAccountId);
      const accounts = (await m.query(
        `SELECT "id", "balance" FROM "fin_chart_of_accounts" WHERE "tenant_id" = $1 AND "id" = ANY($2)`,
        [tenantId, accountIds],
      )) as Array<{ id: number; balance: string | number }>;
      const balMap = new Map(accounts.map((a) => [a.id, a.balance]));
      return boxes.map((b) => ({
        ...b,
        status: b.active ? 'ACTIVE' : 'INACTIVE',
        currentBalance: balMap.get(b.ledgerAccountId) ?? b.openingBalance,
      }));
    });
  }

  async getCashBox(tenantId: string, id: number, manager?: EntityManager) {
    return this.scope.within(tenantId, manager, async (m) => {
      const box = await m.findOne(CashBoxEntity, { where: { tenantId, id } });
      if (!box) {
        throw new NotFoundException(`صندوق با شناسه ${id} یافت نشد.`);
      }
      const account = await m.findOne(ChartOfAccountEntity, {
        where: { tenantId, id: box.ledgerAccountId },
      });
      return {
        ...box,
        status: box.active ? 'ACTIVE' : 'INACTIVE',
        currentBalance: account?.balance ?? box.openingBalance,
      };
    });
  }

  async transferBetweenCashAndBank(
    tenantId: string,
    dto: CashBankTransferDto,
    manager?: EntityManager,
  ) {
    const amountMinor = toMinor(dto.amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException('مبلغ انتقال باید بزرگ‌تر از صفر باشد.');
    }

    return this.scope.within(tenantId, manager, async (m) => {
      const box = await m.findOne(CashBoxEntity, { where: { tenantId, id: dto.cashBoxId } });
      if (!box) {
        throw new NotFoundException(`صندوق با شناسه ${dto.cashBoxId} یافت نشد.`);
      }

      const bank = await m.findOne(BankAccountEntity, { where: { tenantId, id: dto.bankAccountId } });
      if (!bank) {
        throw new NotFoundException(`حساب بانکی با شناسه ${dto.bankAccountId} یافت نشد.`);
      }

      const boxAccount = await m.findOne(ChartOfAccountEntity, {
        where: { tenantId, id: box.ledgerAccountId },
      });
      const bankAccount = await m.findOne(ChartOfAccountEntity, {
        where: { tenantId, id: bank.ledgerAccountId },
      });

      if (!boxAccount || !bankAccount) {
        throw new NotFoundException('حساب دفتر کل متناظر صندوق یا بانک یافت نشد.');
      }

      const isToBank = dto.direction === 'TO_BANK' || dto.direction === 'CASH_TO_BANK';
      const docType = isToBank
        ? 'treasury.cash_bank_transfer'
        : 'treasury.bank_cash_transfer';

      const defaultDesc = isToBank
        ? `انتقال وجه از صندوق ${box.name} به حساب ${bank.name}`
        : `انتقال وجه از حساب ${bank.name} به صندوق ${box.name}`;

      const transferId = `xfer-${box.id}-${bank.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const voucher = await this.postingRules.post(
        tenantId,
        {
          docType,
          sourceType: 'cash_bank_transfer',
          sourceId: transferId,
          date: dto.date,
          amounts: { amount: amountMinor },
          description: dto.description || defaultDesc,
          overrides: {
            cash: boxAccount.code,
            bank: bankAccount.code,
          },
        },
        m,
      );

      return {
        direction: dto.direction,
        amount: fromMinor(amountMinor),
        date: dto.date,
        cashBox: { id: box.id, name: box.name, code: box.code },
        bankAccount: { id: bank.id, name: bank.name, accountNumber: bank.accountNumber },
        voucher,
      };
    });
  }

  async settlePos(tenantId: string, dto: PosSettlementDto, manager?: EntityManager) {
    const grossMinor = toMinor(dto.grossAmount);
    const feeMinor = dto.feeAmount != null ? toMinor(dto.feeAmount) : 0n;

    if (grossMinor <= 0n) {
      throw new BadRequestException('مبلغ ناخالص تسویه پوز باید بزرگ‌تر از صفر باشد.');
    }
    if (feeMinor < 0n) {
      throw new BadRequestException('مبلغ کارمزد نمی‌تواند منفی باشد.');
    }
    if (feeMinor > grossMinor) {
      throw new BadRequestException('مبلغ کارمزد نمی‌تواند از مبلغ ناخالص بیشتر باشد.');
    }

    const netMinor = grossMinor - feeMinor;

    return this.scope.within(tenantId, manager, async (m) => {
      const bank = await m.findOne(BankAccountEntity, { where: { tenantId, id: dto.bankAccountId } });
      if (!bank) {
        throw new NotFoundException(`حساب بانکی با شناسه ${dto.bankAccountId} یافت نشد.`);
      }

      const bankAccount = await m.findOne(ChartOfAccountEntity, {
        where: { tenantId, id: bank.ledgerAccountId },
      });
      if (!bankAccount) {
        throw new NotFoundException('حساب دفتر کل متناظر حساب بانکی یافت نشد.');
      }

      const desc = `تسویه کارتخوان ${dto.terminalNumber}${
        dto.referenceNumber ? ` - پیگیری ${dto.referenceNumber}` : ''
      }`;

      const settlementId = `pos-${bank.id}-${dto.terminalNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const voucher = await this.postingRules.post(
        tenantId,
        {
          docType: 'treasury.pos_settlement',
          sourceType: 'pos_settlement',
          sourceId: settlementId,
          date: dto.date,
          amounts: {
            gross: grossMinor,
            fee: feeMinor,
            net: netMinor,
          },
          description: desc,
          overrides: {
            bank: bankAccount.code,
          },
        },
        m,
      );

      const settlement = m.create(PosSettlementEntity, {
        tenantId,
        bankAccountId: bank.id,
        terminalNumber: dto.terminalNumber.trim(),
        date: dto.date,
        grossAmount: minorToDecimal(grossMinor),
        feeAmount: minorToDecimal(feeMinor),
        netAmount: minorToDecimal(netMinor),
        referenceNumber: dto.referenceNumber?.trim() || null,
        journalEntryId: voucher.entryId,
      });

      const saved = await m.save(PosSettlementEntity, settlement);

      return {
        settlement: saved,
        voucher,
      };
    });
  }
}
