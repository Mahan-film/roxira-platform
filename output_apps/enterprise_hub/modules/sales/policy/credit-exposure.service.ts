import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb, toMinor } from '../../accounting/money';
import { PolicyService } from '../../tenants/policy/policy.service';

export interface CreditExposureSummary {
  openInvoices: bigint;
  unclearedCheques: bigint;
  totalExposure: bigint;
}

export interface CreditExposureCheckResult {
  allowed: boolean;
  warning?: string;
  exposure: bigint;
  limit: bigint;
}

/**
 * Credit exposure calculation and policy enforcement (#584 item 7):
 * Credit exposure = open sale invoices (issued, unpaid) + uncleared received cheques (Sayad).
 * Evaluated against the customer's credit limit (party creditLimit or tenant default policy).
 */
@Injectable()
export class CreditExposureService {
  constructor(
    private readonly scope: TenantScope,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * Computes open invoices and uncleared cheques for a customer party.
   * Runs in a TenantScope transaction to satisfy FORCE RLS.
   */
  async computeExposure(
    tenantId: string,
    partyCode: string,
    manager?: EntityManager,
  ): Promise<CreditExposureSummary> {
    return this.scope.within(tenantId, manager, async (m) => {
      // 1. Open sale invoices (status ISSUED, direction SALE, paid_at NULL)
      const invoiceRows = (await m.query(
        `SELECT COALESCE(SUM("finalPayable"), 0) AS total
         FROM "invoices"
         WHERE "tenant_id" = $1
           AND "direction" = 'SALE'
           AND "status" = 'ISSUED'
           AND "paid_at" IS NULL
           AND ("buyerInfo"->>'partyCode' = $2)`,
        [tenantId, partyCode],
      )) as Array<{ total: string | number }>;

      const openInvoices = fromDb(invoiceRows[0]?.total ?? 0);

      // 2. Uncleared received cheques (direction received, status registered or deposited)
      const chequeRows = (await m.query(
        `SELECT COALESCE(SUM("amount"), 0) AS total
         FROM "fin_cheques"
         WHERE "tenant_id" = $1
           AND "direction" = 'received'
           AND "status" IN ('registered', 'deposited')
           AND "party_code" = $2`,
        [tenantId, partyCode],
      )) as Array<{ total: string | number }>;

      const unclearedCheques = fromDb(chequeRows[0]?.total ?? 0);
      const totalExposure = openInvoices + unclearedCheques;

      return {
        openInvoices,
        unclearedCheques,
        totalExposure,
      };
    });
  }

  /**
   * Evaluates new commitment against the credit limit and enforces the tenant policy.
   * Policy `sales.credit_exposure.mode`:
   *  - 'refuse': throws BadRequestException when exposure + newAmount > limit
   *  - 'warn': permits with warning message (default)
   *  - 'off': no check
   */
  async checkCreditExposure(
    tenantId: string,
    partyCode: string,
    newAmountMinor: bigint,
    manager?: EntityManager,
  ): Promise<CreditExposureCheckResult> {
    const mode = (await this.policyService.get(tenantId, 'sales.credit_exposure.mode', manager)) as string;
    if (mode === 'off') {
      return { allowed: true, exposure: 0n, limit: 0n };
    }

    return this.scope.within(tenantId, manager, async (m) => {
      // Fetch party credit limit
      const partyRows = (await m.query(
        `SELECT "credit_limit" FROM "erp_parties" WHERE "tenant_id" = $1 AND "code" = $2`,
        [tenantId, partyCode],
      )) as Array<{ credit_limit: string | number }>;

      let limit = BigInt(partyRows[0]?.credit_limit ?? 0);
      if (limit <= 0n) {
        // Fall back to tenant policy default limit
        const defaultLimit = (await this.policyService.get(
          tenantId,
          'sales.credit_exposure.default_limit_rial',
          m,
        )) as number;
        if (defaultLimit && defaultLimit > 0) {
          limit = toMinor(defaultLimit);
        }
      }

      if (limit <= 0n) {
        // 0 means no credit limit set; unrestricted
        return { allowed: true, exposure: 0n, limit: 0n };
      }

      const { totalExposure } = await this.computeExposure(tenantId, partyCode, m);

      if (totalExposure + newAmountMinor > limit) {
        if (mode === 'refuse') {
          throw new BadRequestException(
            `سقف اعتبار مشتری تکمیل شده است. سقف اعتبار: ${limit} ریال، میزان تعهدات فعلی (فاکتورهای باز و چک‌های صیادی وصول‌نشده): ${totalExposure} ریال، مبلغ جدید: ${newAmountMinor} ریال.`,
          );
        }
        return {
          allowed: true,
          warning: `میزان تعهدات مشتری (فاکتورهای باز + چک‌های صیادی وصول‌نشده) از سقف اعتبار مصوب (${limit} ریال) فراتر رفته است.`,
          exposure: totalExposure,
          limit,
        };
      }

      return {
        allowed: true,
        exposure: totalExposure,
        limit,
      };
    });
  }
}
