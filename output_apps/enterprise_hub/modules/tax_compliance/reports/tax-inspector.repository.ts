import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { parseMinor } from '../../accounting/money';

export interface RawInvoiceSalesSummary {
  invoicedCount: number;
  totalAmountMinor: bigint;
  taxableAmountMinor: bigint;
  exemptAmountMinor: bigint;
  vatMinor: bigint;
}

export interface RawPurchasesSummary {
  purchaseCount: number;
  deductiblePurchasesMinor: bigint;
  inputVatMinor: bigint;
}

export interface RawLedgerSummary {
  revenueMinor: bigint;
  expenseMinor: bigint;
  totalVouchers: number;
  postedVouchers: number;
  draftVouchers: number;
  isBalanced: boolean;
  hasNumberingGaps: boolean;
  hasClosingVoucher: boolean;
  closingVoucherNumber: string | null;
}

export interface RawMoadianSummary {
  transmittedCount: number;
  totalAmountMinor: bigint;
}

@Injectable()
export class TaxInspectorRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: TenantScope,
  ) {}

  async getSalesSummary(
    tenantId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<RawInvoiceSalesSummary> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = await manager.query(
        `SELECT
           COUNT(*)::int AS "count",
           COALESCE(SUM("finalPayable"), 0) AS "totalPayable",
           COALESCE(SUM("totalTax"), 0) AS "totalTax",
           COALESCE(SUM("totalAmount"), 0) AS "totalAmount"
         FROM "invoices"
         WHERE "tenant_id" = $1
           AND "createdAt" >= $2
           AND "createdAt" < $3
           AND ("direction" = 'SALE' OR "direction" IS NULL)`,
        [tenantId, fromDate, toDate],
      );

      const r = rows[0] || {};
      const totalAmountMinor = r.totalPayable ? parseMinor(String(r.totalPayable)) : 0n;
      const vatMinor = r.totalTax ? parseMinor(String(r.totalTax)) : 0n;
      const taxableMinor = vatMinor > 0n ? totalAmountMinor - vatMinor : 0n;
      const exemptMinor = vatMinor === 0n ? totalAmountMinor : 0n;

      return {
        invoicedCount: Number(r.count || 0),
        totalAmountMinor,
        taxableAmountMinor: taxableMinor,
        exemptAmountMinor: exemptMinor,
        vatMinor,
      };
    });
  }

  async getPurchasesSummary(
    tenantId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<RawPurchasesSummary> {
    return this.scope.run(tenantId, async (manager) => {
      // 1. Purchase invoices
      const invRows = await manager.query(
        `SELECT
           COUNT(*)::int AS "count",
           COALESCE(SUM("finalPayable"), 0) AS "totalPayable",
           COALESCE(SUM("totalTax"), 0) AS "totalTax"
         FROM "invoices"
         WHERE "tenant_id" = $1
           AND "createdAt" >= $2
           AND "createdAt" < $3
           AND "direction" = 'PURCHASE'`,
        [tenantId, fromDate, toDate],
      );

      // 2. Capture documents
      const capRows = await manager.query(
        `SELECT
           COUNT(*)::int AS "count",
           COALESCE(SUM(CAST(COALESCE("edited"->>'total_amount', "extracted"->'draft'->>'total_amount', '0') AS numeric)), 0) AS "totalAmount",
           COALESCE(SUM(CAST(COALESCE("edited"->>'tax_amount', "extracted"->'draft'->>'tax_amount', '0') AS numeric)), 0) AS "totalTax"
         FROM "capture_documents"
         WHERE "tenant_id" = $1
           AND "created_at" >= $2
           AND "created_at" < $3
           AND "status" IN ('posted', 'auto_posted')`,
        [tenantId, fromDate, toDate],
      );

      const rInv = invRows[0] || {};
      const rCap = capRows[0] || {};

      const invAmountMinor = rInv.totalPayable ? parseMinor(String(rInv.totalPayable)) : 0n;
      const invTaxMinor = rInv.totalTax ? parseMinor(String(rInv.totalTax)) : 0n;

      const capAmountMinor = rCap.totalAmount ? parseMinor(String(rCap.totalAmount)) : 0n;
      const capTaxMinor = rCap.totalTax ? parseMinor(String(rCap.totalTax)) : 0n;

      return {
        purchaseCount: Number(rInv.count || 0) + Number(rCap.count || 0),
        deductiblePurchasesMinor: invAmountMinor + capAmountMinor,
        inputVatMinor: invTaxMinor + capTaxMinor,
      };
    });
  }

  async getMoadianSummary(
    tenantId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<RawMoadianSummary> {
    return this.scope.run(tenantId, async (manager) => {
      const rows = await manager.query(
        `SELECT
           COUNT(*)::int AS "count",
           COALESCE(SUM(i."finalPayable"), 0) AS "totalAmount"
         FROM "moadian_submissions" m
         JOIN "invoices" i ON i."id" = m."invoice_id" AND i."tenant_id" = m."tenant_id"
         WHERE m."tenant_id" = $1
           AND m."status" = 'SUCCESS'
           AND i."createdAt" >= $2
           AND i."createdAt" < $3`,
        [tenantId, fromDate, toDate],
      );

      const r = rows[0] || {};
      return {
        transmittedCount: Number(r.count || 0),
        totalAmountMinor: r.totalAmount ? parseMinor(String(r.totalAmount)) : 0n,
      };
    });
  }

  async getLedgerSummary(
    tenantId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<RawLedgerSummary> {
    return this.scope.run(tenantId, async (manager) => {
      const fromStr = fromDate.toISOString().slice(0, 10);
      const toStr = toDate.toISOString().slice(0, 10);

      // Revenue and Expense accounts turnover
      const turnoverRows = await manager.query(
        `SELECT
           a."account_type",
           COALESCE(SUM(l."credit" - l."debit"), 0) AS "netCredit",
           COALESCE(SUM(l."debit" - l."credit"), 0) AS "netDebit"
         FROM "fin_journal_entry_lines" l
         JOIN "fin_journal_entries" e ON e."id" = l."journal_entry_id" AND e."tenant_id" = l."tenant_id"
         JOIN "fin_chart_of_accounts" a ON a."id" = l."account_id" AND a."tenant_id" = l."tenant_id"
         WHERE l."tenant_id" = $1
           AND e."status" = 'POSTED'
           AND e."date" >= $2
           AND e."date" < $3
         GROUP BY a."account_type"`,
        [tenantId, fromStr, toStr],
      );

      let revenueMinor = 0n;
      let expenseMinor = 0n;
      for (const row of turnoverRows) {
        if (row.account_type === 'REVENUE') {
          revenueMinor = row.netCredit ? parseMinor(String(row.netCredit)) : 0n;
        } else if (row.account_type === 'EXPENSE') {
          expenseMinor = row.netDebit ? parseMinor(String(row.netDebit)) : 0n;
        }
      }

      // Vouchers status counts
      const countsRows = await manager.query(
        `SELECT
           COUNT(*)::int AS "total",
           COUNT(CASE WHEN "status" = 'POSTED' THEN 1 END)::int AS "posted",
           COUNT(CASE WHEN "status" = 'DRAFT' OR "status" = 'TEMPORARY' THEN 1 END)::int AS "draft"
         FROM "fin_journal_entries"
         WHERE "tenant_id" = $1
           AND "date" >= $2
           AND "date" < $3`,
        [tenantId, fromStr, toStr],
      );
      const c = countsRows[0] || {};

      // Check balance of all journal lines in the period
      const balanceRows = await manager.query(
        `SELECT
           COALESCE(SUM(l."debit"), 0) AS "totalDebit",
           COALESCE(SUM(l."credit"), 0) AS "totalCredit"
         FROM "fin_journal_entry_lines" l
         JOIN "fin_journal_entries" e ON e."id" = l."journal_entry_id" AND e."tenant_id" = l."tenant_id"
         WHERE l."tenant_id" = $1
           AND e."status" = 'POSTED'
           AND e."date" >= $2
           AND e."date" < $3`,
        [tenantId, fromStr, toStr],
      );
      const b = balanceRows[0] || {};
      const isBalanced = String(b.totalDebit) === String(b.totalCredit);

      // Closing voucher check
      const closingRows = await manager.query(
        `SELECT "entry_number"
         FROM "fin_journal_entries"
         WHERE "tenant_id" = $1
           AND "date" >= $2
           AND "date" < $3
           AND ("entry_number" LIKE 'FC-%' OR "description" LIKE '%اختتامیه%')
         LIMIT 1`,
        [tenantId, fromStr, toStr],
      );
      const hasClosing = closingRows.length > 0;
      const closingVoucherNumber = hasClosing ? closingRows[0].entry_number : null;

      // Check for numbering gaps on permanent numbers
      const permNumberRows = await manager.query(
        `SELECT "permanent_number"
         FROM "fin_journal_entries"
         WHERE "tenant_id" = $1
           AND "date" >= $2
           AND "date" < $3
           AND "status" = 'POSTED'
           AND "permanent_number" IS NOT NULL
         ORDER BY CAST("permanent_number" AS bigint) ASC`,
        [tenantId, fromStr, toStr],
      );

      let hasNumberingGaps = false;
      for (let i = 1; i < permNumberRows.length; i++) {
        const prev = BigInt(permNumberRows[i - 1].permanent_number);
        const curr = BigInt(permNumberRows[i].permanent_number);
        if (curr - prev > 1n) {
          hasNumberingGaps = true;
          break;
        }
      }

      return {
        revenueMinor,
        expenseMinor,
        totalVouchers: Number(c.total || 0),
        postedVouchers: Number(c.posted || 0),
        draftVouchers: Number(c.draft || 0),
        isBalanced,
        hasNumberingGaps,
        hasClosingVoucher: hasClosing,
        closingVoucherNumber,
      };
    });
  }
}
