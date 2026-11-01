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

export interface ChequeInput {
  direction: ChequeDirection;
  sayadNumber: string | null;
  sayadVerified: boolean;
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
  note: string | null;
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
      return repo.save(repo.create({ ...input, tenantId, status: ChequeStatus.REGISTERED, spentToName: null }));
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

  async updateStatus(
    tenantId: string,
    id: number,
    patch: { status: ChequeStatus; spentToName?: string | null },
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
