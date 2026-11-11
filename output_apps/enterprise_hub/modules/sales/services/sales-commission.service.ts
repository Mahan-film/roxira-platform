import { Injectable } from '@nestjs/common';
import { toMinor, fromMinor } from '../../accounting/money';
import { CommissionPoliciesRepository } from '../repositories/commission-policies.repository';
import { SetCommissionPolicyDto } from '../dto/price-tier.dto';
import { SalesCommissionPolicyEntity } from '../entities/sales-commission-policy.entity';

export interface SalesLineForCommission {
  salesRepId: string;
  salesRepName: string;
  category: string;
  saleAmountMinor: bigint;
  invoiceNumber: string;
}

export interface RepCommissionSummary {
  salesRepId: string;
  salesRepName: string;
  totalSalesMinor: bigint;
  totalCommissionMinor: bigint;
  itemsCount: number;
}

export interface MonthlyCommissionReport {
  month: string;
  reps: RepCommissionSummary[];
  grandTotalSalesMinor: bigint;
  grandTotalCommissionMinor: bigint;
}

@Injectable()
export class SalesCommissionService {
  constructor(private readonly policiesRepo: CommissionPoliciesRepository) {}

  /**
   * Calculates commission amount in minor currency units (Rials) using exact BigInt integer math.
   * Rate is given as a percentage (e.g. 5.5 for 5.50%), scaled to integer basis points (550 bps / 10000).
   * Half-up rounding is applied to avoid truncation bias.
   */
  calculateCommission(saleAmountMinor: bigint, ratePercent: number): bigint {
    if (Number.isNaN(ratePercent)) {
      throw new Error(`Commission rate cannot be NaN`);
    }
    if (saleAmountMinor <= 0n || ratePercent <= 0) {
      return 0n;
    }
    if (ratePercent > 100) {
      throw new Error(`Commission rate cannot exceed 100%: received ${ratePercent}`);
    }
    // Basis points: rate * 100 (e.g. 5.5% -> 550)
    const basisPoints = BigInt(Math.round(ratePercent * 100));
    // Half-up rounding for integer division: (numerator + denominator / 2) / denominator
    return (saleAmountMinor * basisPoints + 5000n) / 10000n;
  }

  /**
   * Compiles monthly sales commission report grouped by sales representative.
   */
  generateMonthlyReport(
    month: string,
    salesLines: SalesLineForCommission[],
    categoryRates: Record<string, number>,
  ): MonthlyCommissionReport {
    const repMap = new Map<string, RepCommissionSummary>();

    let grandTotalSales = 0n;
    let grandTotalCommission = 0n;

    for (const line of salesLines) {
      const rate = categoryRates[line.category] ?? 0;
      const commission = this.calculateCommission(line.saleAmountMinor, rate);

      let rep = repMap.get(line.salesRepId);
      if (!rep) {
        rep = {
          salesRepId: line.salesRepId,
          salesRepName: line.salesRepName,
          totalSalesMinor: 0n,
          totalCommissionMinor: 0n,
          itemsCount: 0,
        };
        repMap.set(line.salesRepId, rep);
      }

      rep.totalSalesMinor += line.saleAmountMinor;
      rep.totalCommissionMinor += commission;
      rep.itemsCount += 1;

      grandTotalSales += line.saleAmountMinor;
      grandTotalCommission += commission;
    }

    return {
      month,
      reps: Array.from(repMap.values()),
      grandTotalSalesMinor: grandTotalSales,
      grandTotalCommissionMinor: grandTotalCommission,
    };
  }

  async calculateForTenant(
    tenantId: string,
    month: string,
    salesLines: SalesLineForCommission[],
  ): Promise<MonthlyCommissionReport> {
    const ratesMap = await this.policiesRepo.getRatesMap(tenantId);
    return this.generateMonthlyReport(month, salesLines, ratesMap);
  }

  async listPolicies(tenantId: string): Promise<SalesCommissionPolicyEntity[]> {
    return this.policiesRepo.list(tenantId);
  }

  async setPolicy(tenantId: string, dto: SetCommissionPolicyDto): Promise<SalesCommissionPolicyEntity> {
    return this.policiesRepo.upsert(tenantId, dto.category, dto.commissionRate, dto.active ?? true);
  }

  async deletePolicy(tenantId: string, id: number): Promise<boolean> {
    return this.policiesRepo.deleteById(tenantId, id);
  }
}
