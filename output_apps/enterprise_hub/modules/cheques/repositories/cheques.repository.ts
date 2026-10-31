import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
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
 * The only access point to `fin_cheques` and `fin_cheque_events`. Every read and
 * write carries `tenantId` so one tenant can never see or change another's rows
 * (AGENTS.md §4). Write methods take the transaction manager of the lifecycle move.
 */
@Injectable()
export class ChequesRepository {
  constructor(
    @InjectRepository(ChequeEntity)
    private readonly cheques: Repository<ChequeEntity>,
    @InjectRepository(ChequeEventEntity)
    private readonly events: Repository<ChequeEventEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  private chequeRepo(manager?: EntityManager): Repository<ChequeEntity> {
    return manager ? manager.getRepository(ChequeEntity) : this.cheques;
  }

  private eventRepo(manager?: EntityManager): Repository<ChequeEventEntity> {
    return manager ? manager.getRepository(ChequeEventEntity) : this.events;
  }

  async create(tenantId: string, input: ChequeInput, manager?: EntityManager): Promise<ChequeEntity> {
    const repo = this.chequeRepo(manager);
    return repo.save(repo.create({ ...input, tenantId, status: ChequeStatus.REGISTERED, spentToName: null }));
  }

  async findById(tenantId: string, id: number): Promise<ChequeEntity | null> {
    return this.cheques.findOne({ where: { id, tenantId } });
  }

  /** Row-locked read inside a transaction, so two concurrent moves cannot both pass the state check. */
  async findByIdForUpdate(tenantId: string, id: number, manager: EntityManager): Promise<ChequeEntity | null> {
    return manager.getRepository(ChequeEntity).findOne({
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findBySayadNumber(tenantId: string, sayadNumber: string): Promise<ChequeEntity | null> {
    return this.cheques.findOne({ where: { sayadNumber, tenantId } });
  }

  async list(tenantId: string, filter: ChequeFilter = {}): Promise<ChequeEntity[]> {
    const where: FindOptionsWhere<ChequeEntity> = { tenantId };
    if (filter.direction) where.direction = filter.direction;
    if (filter.status) where.status = filter.status;
    if (filter.dueFrom && filter.dueTo) where.dueDate = Between(filter.dueFrom, filter.dueTo);
    else if (filter.dueFrom) where.dueDate = MoreThanOrEqual(filter.dueFrom);
    else if (filter.dueTo) where.dueDate = LessThanOrEqual(filter.dueTo);
    return this.cheques.find({ where, order: { dueDate: 'ASC', id: 'ASC' } });
  }

  /** Cheques still waiting for a due-date action whose due date is on or before `dueTo`. */
  async listOpenDueBy(tenantId: string, statuses: ChequeStatus[], dueTo: string): Promise<ChequeEntity[]> {
    return this.cheques.find({
      where: { tenantId, status: In(statuses), dueDate: LessThanOrEqual(dueTo) },
      order: { dueDate: 'ASC', id: 'ASC' },
    });
  }

  async updateStatus(
    tenantId: string,
    id: number,
    patch: { status: ChequeStatus; spentToName?: string | null },
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(ChequeEntity).update({ id, tenantId }, patch);
  }

  async addEvent(tenantId: string, input: ChequeEventInput, manager?: EntityManager): Promise<ChequeEventEntity> {
    const repo = this.eventRepo(manager);
    return repo.save(repo.create({ ...input, tenantId }));
  }

  async listEvents(tenantId: string, chequeId: number): Promise<ChequeEventEntity[]> {
    return this.events.find({ where: { tenantId, chequeId }, order: { id: 'ASC' } });
  }
}
