import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  TreasurySmsDraftEntity,
  TreasurySmsDraftStatus,
} from '../entities/treasury-sms-draft.entity';
import { BankSmsParsedResult } from '../sms/bank-sms.types';
import { QueryTreasurySmsDraftsDto } from '../dto/treasury-sms.dto';

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

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
    smsHash: string,
  ): Promise<TreasurySmsDraftEntity> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      const entity = draftRepo.create({
        tenantId,
        userId,
        smsHash,
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
      try {
        return await draftRepo.save(entity);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException('این پیامک بانکی قبلاً ثبت شده است.');
        }
        throw err;
      }
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

  /**
   * Atomically transitions a draft from `draft` to `rejected`.
   * Returns `null` when no matching row exists, or throws `ConflictException` when the draft was already confirmed or rejected.
   */
  async rejectDraftAtomically(
    tenantId: string,
    id: string,
  ): Promise<TreasurySmsDraftEntity | null> {
    return this.tenantScope.run(tenantId, async (manager) => {
      const draftRepo = manager.getRepository(TreasurySmsDraftEntity);
      const res = await draftRepo.update(
        { tenantId, id, status: TreasurySmsDraftStatus.DRAFT },
        {
          status: TreasurySmsDraftStatus.REJECTED,
          matchedDocumentId: null,
          updatedAt: new Date(),
        },
      );
      if ((res.affected ?? 0) === 1) {
        return draftRepo.findOne({ where: { tenantId, id } });
      }
      const existing = await draftRepo.findOne({ where: { tenantId, id } });
      if (!existing) {
        return null;
      }
      throw new ConflictException('سند قطعی صادر شده یا پیش‌نویس قبلاً تغییر وضعیت داده و قابل رد کردن نیست.');
    });
  }

  /** Runs `work` in one tenant-scoped database transaction. */
  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.tenantScope.run(tenantId, work);
  }

  /**
   * Atomically moves a draft from `draft` to `confirmed` (conditional UPDATE; it also takes the row
   * lock until the transaction ends). Returns false when the draft was not in `draft` any more, so a
   * concurrent or repeated confirm can never pass twice.
   */
  async claimDraftForConfirm(tenantId: string, id: string, manager: EntityManager): Promise<boolean> {
    const result = await manager.getRepository(TreasurySmsDraftEntity).update(
      { tenantId, id, status: TreasurySmsDraftStatus.DRAFT },
      { status: TreasurySmsDraftStatus.CONFIRMED, updatedAt: new Date() },
    );
    return (result.affected ?? 0) === 1;
  }

  async setMatchedDocument(tenantId: string, id: string, documentId: number, manager: EntityManager): Promise<void> {
    await manager
      .getRepository(TreasurySmsDraftEntity)
      .update({ tenantId, id }, { matchedDocumentId: documentId, updatedAt: new Date() });
  }
}
