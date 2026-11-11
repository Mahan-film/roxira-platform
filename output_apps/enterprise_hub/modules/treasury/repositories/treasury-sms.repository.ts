import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  TreasurySmsDraftEntity,
  TreasurySmsDraftStatus,
} from '../entities/treasury-sms-draft.entity';
import { BankSmsParsedResult } from '../sms/bank-sms.types';
import { QueryTreasurySmsDraftsDto } from '../dto/treasury-sms.dto';

@Injectable()
export class TreasurySmsRepository {
  constructor(
    @InjectRepository(TreasurySmsDraftEntity)
    private readonly repo: Repository<TreasurySmsDraftEntity>,
    private readonly tenantScope: TenantScope,
  ) {}

  async createDraft(
    tenantId: string,
    userId: string,
    parsed: BankSmsParsedResult,
  ): Promise<TreasurySmsDraftEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      const entity = draftRepo.create({
        tenantId,
        userId,
        bank: parsed.bank,
        bankNameFa: parsed.bankNameFa,
        direction: parsed.direction,
        docKind: parsed.docKind,
        amount: parsed.amountDecimal,
        balance: parsed.balanceDecimal ?? null,
        accountTail: parsed.accountTail ?? null,
        cardTail: parsed.cardTail ?? null,
        reference: parsed.reference ?? null,
        dateTime: parsed.dateTime ? new Date(parsed.dateTime) : null,
        rawText: parsed.rawText,
        status: TreasurySmsDraftStatus.DRAFT,
      });
      return draftRepo.save(entity);
    });
  }

  async listDrafts(
    tenantId: string,
    query?: QueryTreasurySmsDraftsDto,
  ): Promise<TreasurySmsDraftEntity[]> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      const where: FindOptionsWhere<TreasurySmsDraftEntity> = { tenantId };
      if (query?.status) where.status = query.status;
      if (query?.docKind) where.docKind = query.docKind;

      return draftRepo.find({
        where,
        order: { createdAt: 'DESC' },
      });
    });
  }

  async findDraftById(tenantId: string, id: string): Promise<TreasurySmsDraftEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      return draftRepo.findOne({ where: { tenantId, id } });
    });
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: TreasurySmsDraftStatus,
    matchedDocumentId?: number | null,
  ): Promise<TreasurySmsDraftEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      await draftRepo.update(
        { tenantId, id },
        {
          status,
          matchedDocumentId: matchedDocumentId ?? null,
          updatedAt: new Date(),
        },
      );
      return draftRepo.findOne({ where: { tenantId, id } });
    });
  }
}
