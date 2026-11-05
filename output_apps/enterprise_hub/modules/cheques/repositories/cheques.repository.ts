import { Injectable } from '@nestjs/common';
import {
  Between,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ChequeEventEntity } from '../entities/cheque-event.entity';
import { ChequeEntity } from '../entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { SayadRegistrationStatus } from '../sayad/sayad';

export interface ChequeInput {
  direction: ChequeDirection;
  sayadNumber: string | null;
  sayadVerified: boolean;
  sayadRegistrationStatus: SayadRegistrationStatus;
  sayadVerifiedBy: string | null;
  sayadVerifiedAt: Date | null;
  receiverNationalId: string | null;
  chequeNumber: string;
  bankName: string | null;
  /** Exact decimal string, e.g. "50000000.00" (minorToDecimal). */
  amount: string;
  issueDate: string;
  dueDate: string;
  partyName: string;
  partyCode: string | null;
  description: string | null;
}

export interface ChequeFilter {
  direction?: ChequeDirection;
  status?: ChequeStatus;
  dueFrom?: string;
  dueTo?: string;
}

export interface ChequeEventInput {
  chequeId: number;
  fromStatus: ChequeStatus | null;
  toStatus: ChequeStatus;
  eventDate: string;
  journalEntryId: number | null;
  /** Exact decimal string the posting moved; null when nothing was posted. */
  amount: string | null;
  /** Bank account whose ledger account received the bank-side line; null = the legacy 1010. */
  bankAccountId?: number | null;
  note: string | null;
}

export interface ChequeStatusPatch {
  status?: ChequeStatus;
  spentToName?: string | null;
  spentToCode?: string | null;
  spentToNationalId?: string | null;
  settledAmount?: string;
  sayadVerified?: boolean;
  sayadVerifiedBy?: string | null;
  sayadVerifiedAt?: Date | null;
  sayadRegistrationStatus?: SayadRegistrationStatus;
}

/**
 * The only access point to `fin_cheques` and `fin_cheque_events`. Both tables have FORCE row-level
 * security, so every call runs in a TenantScope transaction (`app.tenant_id`), and every query also
 * filters by `tenantId` itself (AGENTS.md §4). Methods that take a `manager` run inside the
 * transaction opened by `runInTransaction`, which has already set the tenant.
 */
@Injectable()
export class ChequesRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return manager ? work(manager) : this.scope.run(tenantId, work);
  }

  create(tenantId: string, input: ChequeInput, manager?: EntityManager): Promise<ChequeEntity> {
    return this.within(tenantId, manager, (m) => {
      const repo = m.getRepository(ChequeEntity);
      return repo.save(repo.create({ ...input, tenantId, status: ChequeStatus.REGISTERED, spentToName: null, spentToCode: null, spentToNationalId: null, settledAmount: '0' }));
    });
  }

  findById(tenantId: string, id: number): Promise<ChequeEntity | null> {
    return this.scope.run(tenantId, (m) => m.getRepository(ChequeEntity).findOne({ where: { id, tenantId } }));
  }

  /** Row-locked read inside a transaction, so two concurrent moves cannot both pass the state check. */
  findByIdForUpdate(tenantId: string, id: number, manager: EntityManager): Promise<ChequeEntity | null> {
    return manager.getRepository(ChequeEntity).findOne({
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findBySayadNumber(tenantId: string, sayadNumber: string): Promise<ChequeEntity | null> {
    return this.scope.run(tenantId, (m) => m.getRepository(ChequeEntity).findOne({ where: { sayadNumber, tenantId } }));
  }

  list(tenantId: string, filter: ChequeFilter = {}): Promise<ChequeEntity[]> {
    const where: FindOptionsWhere<ChequeEntity> = { tenantId };
    if (filter.direction) where.direction = filter.direction;
    if (filter.status) where.status = filter.status;
    if (filter.dueFrom && filter.dueTo) where.dueDate = Between(filter.dueFrom, filter.dueTo);
    else if (filter.dueFrom) where.dueDate = MoreThanOrEqual(filter.dueFrom);
    else if (filter.dueTo) where.dueDate = LessThanOrEqual(filter.dueTo);
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEntity).find({ where, order: { dueDate: 'ASC', id: 'ASC' } }),
    );
  }

  /** Cheques still waiting for a due-date action whose due date is on or before `dueTo`. */
  listOpenDueBy(tenantId: string, statuses: ChequeStatus[], dueTo: string): Promise<ChequeEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEntity).find({
        where: { tenantId, status: In(statuses), dueDate: LessThanOrEqual(dueTo) },
        order: { dueDate: 'ASC', id: 'ASC' },
      }),
    );
  }

  /** Cheques in one status, oldest due date first (the bounced-cheque report). */
  listByStatus(tenantId: string, status: ChequeStatus): Promise<ChequeEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEntity).find({ where: { tenantId, status }, order: { dueDate: 'ASC', id: 'ASC' } }),
    );
  }

  /** Events of the given cheques that moved to `toStatus`, newest first, in one query. */
  listEventsToStatus(tenantId: string, chequeIds: number[], toStatus: ChequeStatus): Promise<ChequeEventEntity[]> {
    if (chequeIds.length === 0) return Promise.resolve([]);
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEventEntity).find({
        where: { tenantId, chequeId: In(chequeIds), toStatus },
        order: { eventDate: 'DESC', id: 'DESC' },
      }),
    );
  }

  /**
   * Events that moved money to or from the bank: a clearing (`cleared`) or a partial payment (status
   * unchanged, amount set). Each carries the journal entry whose bank line the statement should confirm.
   */
  listClearingEvents(tenantId: string, range: { from?: string; to?: string } = {}): Promise<ChequeEventEntity[]> {
    return this.scope.run(tenantId, async (m) => {
      const rows = await m
        .getRepository(ChequeEventEntity)
        .createQueryBuilder('e')
        .where('e.tenant_id = :tenantId', { tenantId })
        .andWhere('e.journal_entry_id IS NOT NULL')
        .andWhere(
          "(e.to_status = 'cleared' OR (e.from_status = e.to_status AND e.amount IS NOT NULL))",
        )
        .andWhere(range.from ? 'e.event_date >= :from' : '1=1', { from: range.from })
        .andWhere(range.to ? 'e.event_date <= :to' : '1=1', { to: range.to })
        .orderBy('e.event_date', 'ASC')
        .addOrderBy('e.id', 'ASC')
        .getMany();
      return rows;
    });
  }

  /** One clearing event (see `listClearingEvents`) by id, or null. */
  async findClearingEvent(tenantId: string, id: number): Promise<ChequeEventEntity | null> {
    const events = await this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEventEntity).find({ where: { tenantId, id } }),
    );
    const e = events[0];
    return e && e.journalEntryId !== null && (e.toStatus === ChequeStatus.CLEARED || (e.fromStatus === e.toStatus && e.amount !== null)) ? e : null;
  }

  findByIds(tenantId: string, ids: number[]): Promise<ChequeEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEntity).find({ where: { tenantId, id: In(ids) } }),
    );
  }

  async updateStatus(
    tenantId: string,
    id: number,
    patch: ChequeStatusPatch,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(ChequeEntity).update({ id, tenantId }, patch);
  }

  addEvent(tenantId: string, input: ChequeEventInput, manager?: EntityManager): Promise<ChequeEventEntity> {
    return this.within(tenantId, manager, (m) => {
      const repo = m.getRepository(ChequeEventEntity);
      return repo.save(repo.create({ ...input, tenantId }));
    });
  }

  listEvents(tenantId: string, chequeId: number): Promise<ChequeEventEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(ChequeEventEntity).find({ where: { tenantId, chequeId }, order: { id: 'ASC' } }),
    );
  }
}
