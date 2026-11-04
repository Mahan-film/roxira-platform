import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../../accounting/money';

export interface VatLedgerAccount {
  code: string;
  name: string;
  accountType: string;
}

export interface VatLedgerTurnover {
  debitMinor: bigint;
  creditMinor: bigint;
}

/**
 * Read-only ledger access for the VAT return reconciliation. Only POSTED, normal entries count
 * (no openings, no year-end closing pair), the same rule the accounting reports use.
 */
@Injectable()
export class VatReturnRepository {
  constructor(private readonly scope: TenantScope) {}

  chartAccounts(tenantId: string): Promise<VatLedgerAccount[]> {
    return this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT code, name, account_type AS "accountType"
           FROM fin_chart_of_accounts WHERE tenant_id = $1 ORDER BY id`,
        [tenantId],
      ),
    );
  }

  /** Debit and credit turnover of one account over the Tehran days `[fromDay, toDay)`. */
  async turnover(tenantId: string, code: string, fromDay: string, toDay: string): Promise<VatLedgerTurnover> {
    const rows: Array<{ debit: string; credit: string }> = await this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND a.code = $2 AND e.status = 'POSTED'
            AND e.entry_type = 'NORMAL' AND e.entry_number NOT LIKE 'OB-%'
            AND CAST(e.date AS date) >= $3 AND CAST(e.date AS date) < $4`,
        [tenantId, code, fromDay, toDay],
      ),
    );
    return { debitMinor: fromDb(rows[0]?.debit), creditMinor: fromDb(rows[0]?.credit) };
  }
}
