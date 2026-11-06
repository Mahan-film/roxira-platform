import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../../accounting/money';
import { ContractMovementEntity } from '../entities/contract-movement.entity';

export interface MovementInput {
  contractId: number;
  kind: 'advance' | 'retention_release';
  movementDate: string;
  amount: string;
  requestKey: string | null;
  termsSnapshot: unknown | null;
}

@Injectable()
export class MovementRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  list(tenantId: string, contractId: number): Promise<ContractMovementEntity[]> {
    return this.within(tenantId, undefined, (m) =>
      m.getRepository(ContractMovementEntity).find({ where: { tenantId, contractId }, order: { id: 'ASC' } }),
    );
  }

  findByKey(tenantId: string, contractId: number, kind: string, requestKey: string, manager: EntityManager): Promise<ContractMovementEntity | null> {
    return this.within(tenantId, manager, (m) => m.getRepository(ContractMovementEntity).findOne({ where: { tenantId, contractId, kind: kind as never, requestKey } }));
  }

  insert(tenantId: string, input: MovementInput, manager: EntityManager): Promise<ContractMovementEntity> {
    return this.within(tenantId, manager, (m) => {
      const repo = m.getRepository(ContractMovementEntity);
      return repo.save(repo.create({ ...input, tenantId }));
    });
  }

  async attachJournal(tenantId: string, id: number, entry: { journalEntryId: number; journalEntryNumber: string }, manager: EntityManager): Promise<void> {
    await this.within(tenantId, manager, (m) => m.getRepository(ContractMovementEntity).update({ tenantId, id }, entry));
  }

  /** Sum of one kind for a contract, in minor units. */
  sum(tenantId: string, contractId: number, kind: 'advance' | 'retention_release', manager: EntityManager): Promise<bigint> {
    return this.within(tenantId, manager, async (m) => {
      const [row] = await m.query(
        `SELECT COALESCE(SUM("amount"), 0)::text AS total FROM "erp_contract_movements" WHERE "tenant_id" = $1 AND "contract_id" = $2 AND "kind" = $3`,
        [tenantId, contractId, kind],
      );
      return fromDb(row.total);
    });
  }

  /** Retention withheld by POSTED statements of a contract, in minor units. */
  retentionHeld(tenantId: string, contractId: number, manager: EntityManager): Promise<bigint> {
    return this.within(tenantId, manager, async (m) => {
      const [row] = await m.query(
        `SELECT COALESCE(SUM("retention_amount"), 0)::text AS total FROM "erp_progress_statements" WHERE "tenant_id" = $1 AND "contract_id" = $2 AND "status" = 'posted'`,
        [tenantId, contractId],
      );
      return fromDb(row.total);
    });
  }
}
