import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager, IsNull } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { fromMinor, minorToDecimal, toMinor } from '../../accounting/money';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { CashBankTransferDto, CreateCashBoxDto, PosSettlementDto } from '../dto/cash-box.dto';
import { BankAccountEntity } from '../entities/bank-account.entity';
import { CashBoxEntity } from '../entities/cash-box.entity';
import { CashTransferEntity } from '../entities/cash-transfer.entity';
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
      // Validate unique code within tenant
      const existing = await m.findOne(CashBoxEntity, {
        where: { tenantId, code: dto.code.trim() },
      });
      if (existing) {
        throw new ConflictException(`صندوقی با کد «${dto.code.trim()}» قبلاً ثبت شده است.`);
      }

      // Validate ledger account belongs to tenant and is active ASSET moein/tafsili
      const account = await m.findOne(ChartOfAccountEntity, {
        where: { id: dto.ledgerAccountId, tenantId },
      });
      if (!account) {
        throw new NotFoundException(`حساب دفتر کل با شناسه ${dto.ledgerAccountId} یافت نشد.`);
      }
      if (account.level && account.level !== AccountLevel.MOEIN && account.level !== AccountLevel.TAFSILI) {
        throw new BadRequestException('حساب دفتر کل انتخاب‌شده باید در سطح معین یا تفصیلی باشد.');
      }
      if (account.accountType !== AccountType.ASSET) {
        throw new BadRequestException('حساب دفتر کل صندوق باید از نوع دارایی (ASSET) باشد.');
      }
      if (account.currency && dto.currency && account.currency !== dto.currency) {
        throw new BadRequestException('واحد پول صندوق با واحد پول حساب دفتر کل همخوانی ندارد.');
      }

      const openingMinor = dto.openingBalance != null ? toMinor(dto.openingBalance) : 0n;
      if (openingMinor < 0n) {
        throw new BadRequestException('مانده اولیه صندوق نمی‌تواند منفی باشد.');
      }

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
      if (!box.active) {
        throw new BadRequestException('صندوق انتخاب‌شده غیرفعال است.');
      }

      const bank = await m.findOne(BankAccountEntity, { where: { tenantId, id: dto.bankAccountId } });
      if (!bank) {
        throw new NotFoundException(`حساب بانکی با شناسه ${dto.bankAccountId} یافت نشد.`);
      }

      if (box.currency !== bank.currency) {
        throw new BadRequestException(`واحد پول صندوق (${box.currency}) با واحد پول حساب بانکی (${bank.currency}) همخوانی ندارد.`);
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

      const isToBank = dto.direction === 'TO_BANK';
      const docType = isToBank
        ? 'treasury.cash_bank_transfer'
        : 'treasury.bank_cash_transfer';

      const defaultDesc = isToBank
        ? `انتقال وجه از صندوق ${box.name} به حساب ${bank.name}`
        : `انتقال وجه از حساب ${bank.name} به صندوق ${box.name}`;

      const idempotencyKey =
        dto.idempotencyKey?.trim() ||
        `xfer:${box.id}:${bank.id}:${dto.date}:${amountMinor}:${dto.direction}`;

      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            tenantId,
            cashBoxId: box.id,
            bankAccountId: bank.id,
            date: dto.date,
            amount: amountMinor.toString(),
            direction: dto.direction,
          }),
        )
        .digest('hex');

      // Check existing cash transfer record for idempotency
      const existingTransfer = await m.findOne(CashTransferEntity, {
        where: { tenantId, idempotencyKey },
      });
      if (existingTransfer) {
        if (
          existingTransfer.idempotencyFingerprint &&
          existingTransfer.idempotencyFingerprint !== fingerprint
        ) {
          throw new ConflictException(
            `کلید یکتایی «${idempotencyKey}» قبلاً با محتوای دیگری ثبت شده است؛ برای انتقال جدید کلید جدید بفرستید.`,
          );
        }
        const existingEntry = existingTransfer.journalEntryId
          ? await m.findOne(JournalEntryEntity, { where: { tenantId, id: existingTransfer.journalEntryId } })
          : null;
        return {
          direction: dto.direction,
          amount: fromMinor(amountMinor),
          date: dto.date,
          cashBox: { id: box.id, name: box.name, code: box.code },
          bankAccount: { id: bank.id, name: bank.name, accountNumber: bank.accountNumber },
          voucher: { entryId: existingTransfer.journalEntryId!, entryNumber: existingEntry?.entryNumber ?? '', replayed: true },
        };
      }

      const voucher = await this.postingRules.post(
        tenantId,
        {
          docType,
          sourceType: 'cash_bank_transfer',
          sourceId: idempotencyKey,
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

      // Save CashTransferEntity
      const transferRecord = m.create(CashTransferEntity, {
        tenantId,
        cashBoxId: box.id,
        bankAccountId: bank.id,
        direction: dto.direction,
        amount: minorToDecimal(amountMinor),
        date: dto.date,
        journalEntryId: voucher.entryId,
        idempotencyKey,
        idempotencyFingerprint: fingerprint,
      });
      await m.save(CashTransferEntity, transferRecord);

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

      const idempotencyKey =
        dto.idempotencyKey?.trim() ||
        `pos:${bank.id}:${dto.terminalNumber.trim()}:${dto.date}:${dto.referenceNumber?.trim() || ''}`;

      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            tenantId,
            bankAccountId: bank.id,
            terminalNumber: dto.terminalNumber.trim(),
            date: dto.date,
            grossAmount: grossMinor.toString(),
            feeAmount: feeMinor.toString(),
            referenceNumber: dto.referenceNumber?.trim() || null,
          }),
        )
        .digest('hex');

      // Check existing POS settlement
      const existingSettlement = await m.findOne(PosSettlementEntity, {
        where: dto.idempotencyKey?.trim()
          ? { tenantId, idempotencyKey: dto.idempotencyKey.trim() }
          : {
              tenantId,
              bankAccountId: bank.id,
              terminalNumber: dto.terminalNumber.trim(),
              date: dto.date,
              referenceNumber: dto.referenceNumber?.trim() || IsNull(),
            },
      });

      if (existingSettlement) {
        if (
          existingSettlement.idempotencyFingerprint &&
          existingSettlement.idempotencyFingerprint !== fingerprint
        ) {
          throw new ConflictException(
            `کلید یکتایی «${idempotencyKey}» قبلاً با محتوای دیگری ثبت شده است؛ برای تسویه جدید کلید جدید بفرستید.`,
          );
        }
        const existingVoucher = existingSettlement.journalEntryId
          ? await m.findOne(JournalEntryEntity, {
              where: { tenantId, id: existingSettlement.journalEntryId },
            })
          : null;
        return {
          settlement: existingSettlement,
          voucher: {
            entryId: existingSettlement.journalEntryId!,
            entryNumber: existingVoucher?.entryNumber ?? '',
            replayed: true,
          },
        };
      }

      const voucher = await this.postingRules.post(
        tenantId,
        {
          docType: 'treasury.pos_settlement',
          sourceType: 'pos_settlement',
          sourceId: idempotencyKey,
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
        idempotencyKey,
        idempotencyFingerprint: fingerprint,
      });

      const saved = await m.save(PosSettlementEntity, settlement);

      return {
        settlement: saved,
        voucher,
      };
    });
  }
}
