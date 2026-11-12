import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { TreasurySmsRepository } from '../repositories/treasury-sms.repository';
import { normaliseSms, parseBankSms, toTehranDateString } from '../sms/bank-sms.parser';
import { BankSmsParsedResult } from '../sms/bank-sms.types';
import {
  TreasurySmsDraftEntity,
  TreasurySmsDraftStatus,
} from '../entities/treasury-sms-draft.entity';
import {
  ConfirmTreasurySmsDraftDto,
  ParsedBankSmsResponseDto,
  QueryTreasurySmsDraftsDto,
} from '../dto/treasury-sms.dto';
import {
  CreateTreasuryDocumentDto,
  TreasuryDocumentDetailResponseDto,
} from '../dto/treasury.dto';
import {
  TreasuryDocKind,
  TreasuryMethod,
  TreasuryPartyType,
} from '../enums/treasury.enum';

@Injectable()
export class TreasurySmsService {
  constructor(
    private readonly smsRepository: TreasurySmsRepository,
    private readonly treasuryService: TreasuryService,
  ) {}

  /**
   * Parses Iranian bank SMS without persisting.
   */
  parseSms(text: string): BankSmsParsedResult {
    try {
      return parseBankSms(text);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /** Parse preview for the API: decimal strings only (the parser's bigint minor units are not JSON-safe). */
  previewSms(text: string): ParsedBankSmsResponseDto {
    const r = this.parseSms(text);
    return {
      bank: r.bank,
      bankNameFa: r.bankNameFa,
      direction: r.direction,
      docKind: r.docKind,
      amount: r.amountDecimal,
      balance: r.balanceDecimal,
      dateTime: r.dateTime,
      cardTail: r.cardTail,
      accountTail: r.accountTail,
      reference: r.reference,
      rawText: r.rawText,
    };
  }

  /**
   * Captures bank SMS, extracts fields, and records a draft treasury receipt or payment.
   */
  async captureSms(
    tenantId: string,
    userId: string,
    text: string,
  ): Promise<TreasurySmsDraftEntity> {
    const parsed = this.parseSms(text);
    const smsHash = createHash('sha256')
      .update(normaliseSms(text).replace(/\s+/g, ' ').trim())
      .digest('hex');
    return this.smsRepository.createDraft(tenantId, userId, parsed, smsHash);
  }

  /**
   * Lists treasury SMS drafts for the tenant.
   */
  async listDrafts(
    tenantId: string,
    query?: QueryTreasurySmsDraftsDto,
  ): Promise<TreasurySmsDraftEntity[]> {
    return this.smsRepository.listDrafts(tenantId, query);
  }

  /**
   * Retrieves a single draft by ID.
   */
  async getDraft(tenantId: string, id: string): Promise<TreasurySmsDraftEntity> {
    const draft = await this.smsRepository.findDraftById(tenantId, id);
    if (!draft) {
      throw new NotFoundException('پیش‌نویس پیامک بانکی یافت نشد.');
    }
    return draft;
  }

  /**
   * Confirms a draft bank SMS and posts an official treasury receipt/payment with automatic voucher.
   */
  async confirmDraft(
    tenantId: string,
    userId: string,
    id: string,
    dto: ConfirmTreasurySmsDraftDto,
  ): Promise<TreasuryDocumentDetailResponseDto> {
    const draft = await this.getDraft(tenantId, id);

    if (draft.status === TreasurySmsDraftStatus.CONFIRMED) {
      throw new ConflictException('این پیش‌نویس پیامک بانکی قبلاً تأیید و صادر شده است.');
    }
    if (draft.status === TreasurySmsDraftStatus.REJECTED) {
      throw new BadRequestException('پیش‌نویس رد شده قابل تأیید نیست.');
    }

    const defaultPartyType =
      draft.docKind === TreasuryDocKind.RECEIPT
        ? TreasuryPartyType.CUSTOMER
        : TreasuryPartyType.SUPPLIER;

    const docDate =
      dto.docDate ??
      (draft.dateTime ? toTehranDateString(draft.dateTime) : null);
    if (!docDate) {
      throw new BadRequestException('تاریخ تراکنش در پیامک یافت نشد؛ لطفاً تاریخ سند را ارسال کنید.');
    }

    const docDto: CreateTreasuryDocumentDto = {
      kind: draft.docKind,
      partyType: dto.partyType ?? defaultPartyType,
      partyCode: dto.partyCode,
      partyName: dto.partyName,
      docDate,
      methods: [
        {
          method: TreasuryMethod.BANK_TRANSFER,
          amount: draft.amount,
          bankAccountId: dto.bankAccountId,
          reference: draft.reference ?? undefined,
        },
      ],
      allocations: dto.allocations,
      description: dto.description ?? `ثبت خودکار از پیامک ${draft.bankNameFa}`,
    };

    // One transaction: claim the draft (conditional UPDATE draft -> confirmed, which also locks the
    // row), post the document on the same manager, record the link. A failure anywhere rolls the
    // claim back; a second concurrent confirm gets 0 affected rows and posts nothing.
    return this.smsRepository.runInTransaction(tenantId, async (manager) => {
      const claimed = await this.smsRepository.claimDraftForConfirm(tenantId, id, manager);
      if (!claimed) {
        throw new ConflictException('این پیش‌نویس پیامک بانکی قبلاً تأیید و صادر شده است.');
      }
      const doc = await this.treasuryService.createDocument(tenantId, docDto, manager);
      await this.smsRepository.setMatchedDocument(tenantId, id, doc.id, manager);
      return doc;
    });
  }

  /**
   * Rejects an unneeded draft atomically.
   */
  async rejectDraft(tenantId: string, id: string): Promise<TreasurySmsDraftEntity> {
    const updated = await this.smsRepository.rejectDraftAtomically(tenantId, id);
    if (!updated) {
      throw new NotFoundException('پیش‌نویس پیامک بانکی یافت نشد.');
    }
    return updated;
  }
}
