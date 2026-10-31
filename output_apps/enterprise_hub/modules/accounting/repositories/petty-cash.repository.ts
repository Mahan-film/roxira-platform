import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { PettyCashFundEntity, PettyCashTransactionEntity } from '../entities/petty-cash.entity';
import { PettyCashKind, PettyCashStatus } from '../enums/accounting.enum';

/** Petty cash tables have tenant RLS: every call sets `app.tenant_id` and filters by tenant too. */
@Injectable()
export class PettyCashRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Runs `work` in one transaction scoped to the tenant. */
  scoped<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  listFunds(tenantId: string): Promise<PettyCashFundEntity[]> {
    return this.scoped(tenantId, (m) =>
      m.find(PettyCashFundEntity, { where: { tenantId }, order: { name: 'ASC' } }),
    );
  }

  findFund(tenantId: string, id: number, manager: EntityManager): Promise<PettyCashFundEntity | null> {
    return manager.findOne(PettyCashFundEntity, { where: { tenantId, id } });
  }

  findFundByName(tenantId: string, name: string, manager: EntityManager): Promise<PettyCashFundEntity | null> {
    return manager.findOne(PettyCashFundEntity, { where: { tenantId, name } });
  }

  findFundByAccount(tenantId: string, ledgerAccountId: number, manager: EntityManager): Promise<PettyCashFundEntity | null> {
    return manager.findOne(PettyCashFundEntity, { where: { tenantId, ledgerAccountId } });
  }

  /** The fund, row-locked: all money moves of one fund run one at a time. */
  lockFund(tenantId: string, id: number, manager: EntityManager): Promise<PettyCashFundEntity | null> {
    return manager.findOne(PettyCashFundEntity, {
      where: { tenantId, id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  saveFund(tenantId: string, fund: Partial<PettyCashFundEntity>, manager: EntityManager): Promise<PettyCashFundEntity> {
    return manager.save(manager.create(PettyCashFundEntity, { ...fund, tenantId }));
  }

  saveTransaction(
    tenantId: string,
    data: Partial<PettyCashTransactionEntity>,
    manager: EntityManager,
  ): Promise<PettyCashTransactionEntity> {
    return manager.save(manager.create(PettyCashTransactionEntity, { ...data, tenantId }));
  }

  listTransactions(tenantId: string, fundId: number, manager: EntityManager): Promise<PettyCashTransactionEntity[]> {
    return manager.find(PettyCashTransactionEntity, {
      where: { tenantId, fundId },
      order: { date: 'DESC', id: 'DESC' },
      take: 1000,
    });
  }

  findPendingExpenses(
    tenantId: string,
    fundId: number,
    ids: number[],
    manager: EntityManager,
  ): Promise<PettyCashTransactionEntity[]> {
    return manager.find(PettyCashTransactionEntity, {
      where: { tenantId, fundId, id: In(ids), kind: PettyCashKind.EXPENSE, status: PettyCashStatus.PENDING },
    });
  }

  /** Sum of the receipts waiting for settlement, as an exact numeric string. */
  async pendingTotal(tenantId: string, fundId: number, manager: EntityManager): Promise<string> {
    const rows: Array<{ total: string }> = await manager.query(
      `SELECT COALESCE(SUM(amount), 0) AS "total" FROM fin_petty_cash_transactions
        WHERE tenant_id = $1 AND fund_id = $2 AND kind = 'EXPENSE' AND status = 'PENDING'`,
      [tenantId, fundId],
    );
    return rows[0].total;
  }

  /** The ledger balance of an account, summed from posted lines. */
  async ledgerBalance(tenantId: string, accountId: number, manager: EntityManager): Promise<string> {
    const rows: Array<{ balance: string }> = await manager.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS "balance"
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.account_id = $2 AND e.status = 'POSTED'`,
      [tenantId, accountId],
    );
    return rows[0].balance;
  }
}
