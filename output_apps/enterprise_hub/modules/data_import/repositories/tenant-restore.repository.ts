import { Injectable, BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { CORE_TENANT_TABLES, CoreTenantTableName } from './tenant-export.repository';

/**
 * Strict whitelist of allowed database column identifiers per core tenant table (Lesson 9, 20).
 * Prevents SQL injection through untrusted archive column names.
 */
export const ALLOWED_RESTORE_COLUMNS: Record<CoreTenantTableName, ReadonlySet<string>> = {
  fin_chart_of_accounts: new Set([
    'id', 'tenant_id', 'code', 'name', 'account_type', 'currency', 'balance',
    'level', 'parent_code', 'report_line', 'system_posted_only', 'created_at', 'updated_at',
  ]),
  fin_journal_entries: new Set([
    'id', 'tenant_id', 'entry_number', 'date', 'description', 'status',
    'entry_type', 'firm_user_id', 'idempotency_key', 'idempotency_fingerprint',
    'reverses_entry_id', 'permanent_number', 'permanent_fiscal_year_id', 'tag',
    'version', 'created_at', 'updated_at',
  ]),
  fin_journal_entry_lines: new Set([
    'id', 'tenant_id', 'journal_entry_id', 'entry_id', 'account_id', 'debit', 'credit',
    'description', 'currency', 'is_rounding', 'party_code', 'cost_center_id',
    'project_id', 'detail_id', 'branch_id', 'amount_fx', 'fx_rate',
    'fx_rate_applied', 'book_debit', 'book_credit', 'tx_debit', 'tx_credit',
    'tx_currency_code', 'reporting_debit', 'reporting_credit', 'reporting_fx_rate',
    'reporting_currency_code',
  ]),
  fin_cheques: new Set([
    'id', 'tenant_id', 'cheque_number', 'sayad_number', 'bank_name', 'amount',
    'due_date', 'issue_date', 'party_code', 'party_name', 'direction', 'status',
    'description', 'receiver_national_id', 'spent_to_name', 'spent_to_national_id',
    'spent_to_code', 'sayad_verified', 'sayad_verified_at', 'sayad_verified_by',
    'sayad_registration_status', 'settled_amount', 'created_at', 'updated_at',
  ]),
  erp_parties: new Set([
    'id', 'tenant_id', 'code', 'name', 'role', 'national_id', 'economic_code',
    'phone', 'email', 'credit_limit', 'customer_group', 'active', 'pii_ciphertext',
    'erased_at', 'created_at', 'updated_at',
  ]),
  invoices: new Set([
    'id', 'tenant_id', 'tax_invoice_number', 'invoice_number', 'customer_id', 'subject', 'direction',
    'status', 'issued_at', 'paid_at', 'currency', 'exchange_rate', 'total_amount',
    'total_discount', 'total_tax', 'final_payable', 'items', 'payments',
    'base_currency', 'base_total_amount', 'base_total_tax', 'base_final_payable',
    'amount_fx', 'fx_rate', 'einvoice_type', 'jurisdiction', 'idempotency_key',
    'request_hash', 'journal_entry_id', 'paid_journal_entry_id',
    'reversal_journal_entry_id', 'branch_id', 'warehouse_id', 'seller_info',
    'buyer_info', 'posting_error', 'posting_meta', 'related_invoice_id',
    'created_at', 'updated_at',
  ]),
  erp_stock_items: new Set([
    'id', 'tenant_id', 'sku', 'name', 'barcode', 'quantity', 'min_quantity',
    'primary_unit', 'secondary_unit', 'unit_ratio', 'batch_number', 'created_at', 'updated_at',
  ]),
};

const IDENTIFIER_REGEX = /^[a-z0-9_]+$/;

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

@Injectable()
export class TenantRestoreRepository {
  constructor(private readonly tenantScope: TenantScope) {}

  /**
   * Counts existing journal entries for a tenant to prevent accidental overwrite
   * or restore into an active ledger without explicit permission.
   */
  async countExistingJournalEntries(tenantId: string): Promise<number> {
    return this.tenantScope.within(tenantId, undefined, async (em: EntityManager) => {
      const rows = await em.query(
        `SELECT COUNT(*)::int AS cnt FROM "fin_journal_entries" WHERE "tenant_id" = $1`,
        [tenantId],
      );
      return Number(rows[0]?.cnt ?? 0);
    });
  }

  /**
   * Restores a batch of rows into the specified table within the tenant's RLS scope.
   * Strictly validates column names against whitelist and parameterized values.
   */
  async restoreTableRows(
    targetTenantId: string,
    table: CoreTenantTableName,
    rawRows: Record<string, any>[],
  ): Promise<{ inserted: number; skipped: number }> {
    if (!CORE_TENANT_TABLES.includes(table)) {
      throw new BadRequestException(`Table "${table}" is not allowed for restore`);
    }

    const allowedCols = ALLOWED_RESTORE_COLUMNS[table];
    let inserted = 0;
    let skipped = 0;

    await this.tenantScope.within(targetTenantId, undefined, async (em: EntityManager) => {
      for (const rawRow of rawRows) {
        if (!rawRow || typeof rawRow !== 'object') continue;

        // Normalize keys to snake_case and validate
        const normalizedRow: Record<string, any> = {};
        for (const [key, val] of Object.entries(rawRow)) {
          const snakeKey = toSnakeCase(key);
          if (!IDENTIFIER_REGEX.test(snakeKey)) {
            throw new BadRequestException(
              `Invalid column identifier "${key}" in table "${table}" (SQL injection guard)`,
            );
          }
          if (!allowedCols.has(snakeKey)) {
            throw new BadRequestException(
              `Column "${key}" (${snakeKey}) is not permitted on table "${table}"`,
            );
          }
          normalizedRow[snakeKey] = val;
        }

        // Enforce tenant isolation: overwrite incoming tenant_id with verified targetTenantId
        normalizedRow['tenant_id'] = targetTenantId;

        const cols = Object.keys(normalizedRow);
        if (cols.length === 0) continue;

        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const values = cols.map((c) => normalizedRow[c]);

        const res = await em.query(
          `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING 1`,
          values,
        );

        if (Array.isArray(res) && res.length > 0) {
          inserted++;
        } else {
          skipped++;
        }
      }
    });

    return { inserted, skipped };
  }
}
