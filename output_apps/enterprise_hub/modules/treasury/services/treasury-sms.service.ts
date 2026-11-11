import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { TreasurySmsRepository } from '../repositories/treasury-sms.repository';
import { parseBankSms, isBankSms } from '../sms/bank-sms.parser';
import { BankSmsParsedResult } from '../sms/bank-sms.types';
import {
  TreasurySmsDraftEntity,
  TreasurySmsDraftStatus,
} from '../entities/treasury-sms-draft.entity';
import {
  ConfirmTreasurySmsDraftDto,
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

  isRecognisedSms(text: string): boolean {
    return isBankSms(text);
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
    return this.smsRepository.createDraft(tenantId, userId, parsed);
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
      (draft.dateTime
        ? draft.dateTime.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10));

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

    const doc = await this.treasuryService.createDocument(tenantId, docDto);
    await this.smsRepository.updateStatus(
      tenantId,
      id,
      TreasurySmsDraftStatus.CONFIRMED,
      doc.id,
    );

    return doc;
  }

  /**
   * Rejects an unneeded draft.
   */
  async rejectDraft(tenantId: string, id: string): Promise<TreasurySmsDraftEntity> {
    const draft = await this.getDraft(tenantId, id);
    if (draft.status === TreasurySmsDraftStatus.CONFIRMED) {
      throw new ConflictException('سند قطعی صادر شده و پیش‌نویس قابل رد کردن نیست.');
    }

    const updated = await this.smsRepository.updateStatus(
      tenantId,
      id,
      TreasurySmsDraftStatus.REJECTED,
      null,
    );
    return updated!;
  }
}
