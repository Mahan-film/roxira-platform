import { Injectable } from '@nestjs/common';
import { parseMinor } from '../../accounting/money';
import {
  BankChequeMaturityView,
  ChequeMaturityBucketView,
  ChequeMaturityItemView,
  ChequeMaturityReportView,
  PartyChequeMaturityView,
  QueryChequeMaturityDto,
} from '../dto/cheque-maturity-report.dto';
import { ChequeEntity } from '../entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { ChequesRepository } from '../repositories/cheques.repository';

const BUCKET_DEFINITIONS: Array<{
  key: string;
  labelFa: string;
  minDays?: number;
  maxDays?: number;
}> = [
  { key: 'overdue_90_plus', labelFa: 'معوق بیش از ۹۰ روز', maxDays: -91 },
  { key: 'overdue_61_90', labelFa: 'معوق ۶۱ تا ۹۰ روز', minDays: -90, maxDays: -61 },
  { key: 'overdue_31_60', labelFa: 'معوق ۳۱ تا ۶۰ روز', minDays: -60, maxDays: -31 },
  { key: 'overdue_1_30', labelFa: 'معوق ۱ تا ۳۰ روز', minDays: -30, maxDays: -1 },
  { key: 'today', labelFa: 'سررسید امروز', minDays: 0, maxDays: 0 },
  { key: 'due_1_7', labelFa: 'سررسید ۱ تا ۷ روز آینده', minDays: 1, maxDays: 7 },
  { key: 'due_8_30', labelFa: 'سررسید ۸ تا ۳۰ روز آینده', minDays: 8, maxDays: 30 },
  { key: 'due_31_60', labelFa: 'سررسید ۳۱ تا ۶۰ روز آینده', minDays: 31, maxDays: 60 },
  { key: 'due_61_90', labelFa: 'سررسید ۶۱ تا ۹۰ روز آینده', minDays: 61, maxDays: 90 },
  { key: 'due_90_plus', labelFa: 'سررسید بیش از ۹۰ روز آینده', minDays: 91 },
];

function diffInDays(targetDateStr: string, asOfDateStr: string): number {
  const target = new Date(targetDateStr + 'T00:00:00Z').getTime();
  const base = new Date(asOfDateStr + 'T00:00:00Z').getTime();
  return Math.round((target - base) / 86_400_000);
}

@Injectable()
export class ChequeMaturityReportService {
  constructor(private readonly repo: ChequesRepository) {}

  async generateReport(
    tenantId: string,
    query: QueryChequeMaturityDto = {},
  ): Promise<ChequeMaturityReportView> {
    const asOfDate = query.asOfDate ?? new Date().toISOString().slice(0, 10);
    const direction = query.direction ?? 'all';

    // Query active/open cheques (excluding settled or canceled if not relevant)
    const allCheques = await this.repo.list(tenantId, {
      direction: direction === 'all' ? undefined : (direction as ChequeDirection),
    });

    const filteredCheques = allCheques.filter((c) => {
      if (query.bankName && c.bankName !== query.bankName) return false;
      return true;
    });

    // Initialize buckets
    const buckets: Record<string, ChequeMaturityBucketView> = {};
    for (const b of BUCKET_DEFINITIONS) {
      buckets[b.key] = {
        bucketKey: b.key,
        labelFa: b.labelFa,
        minDays: b.minDays,
        maxDays: b.maxDays,
        count: 0,
        totalAmountMinor: '0',
        items: [],
      };
    }

    let totalMinor = 0n;
    let overdueMinor = 0n;
    let overdueCount = 0;
    let todayMinor = 0n;
    let todayCount = 0;
    let upcomingMinor = 0n;
    let upcomingCount = 0;
    let sumProductDays = 0n;

    const bankAgg: Record<string, { count: number; totalMinor: bigint }> = {};
    const partyAgg: Record<string, { partyCode: string | null; count: number; totalMinor: bigint }> = {};
    const sayadAgg: Record<string, { count: number; totalMinor: bigint }> = {};

    for (const cheque of filteredCheques) {
      const minor = parseMinor(cheque.amount);
      const days = diffInDays(cheque.dueDate, asOfDate);

      const itemView: ChequeMaturityItemView = {
        id: cheque.id,
        chequeNumber: cheque.chequeNumber,
        sayadNumber: cheque.sayadNumber,
        sayadRegistrationStatus: cheque.sayadRegistrationStatus,
        direction: cheque.direction,
        status: cheque.status,
        bankName: cheque.bankName,
        partyName: cheque.partyName,
        partyCode: cheque.partyCode,
        amountMinor: minor.toString(),
        dueDate: cheque.dueDate,
        issueDate: cheque.issueDate,
        daysToDue: days,
      };

      // Find matching bucket
      let matchedBucketKey = 'due_90_plus';
      for (const b of BUCKET_DEFINITIONS) {
        const afterMin = b.minDays === undefined || days >= b.minDays;
        const beforeMax = b.maxDays === undefined || days <= b.maxDays;
        if (afterMin && beforeMax) {
          matchedBucketKey = b.key;
          break;
        }
      }

      const bucket = buckets[matchedBucketKey];
      bucket.count += 1;
      bucket.totalAmountMinor = (BigInt(bucket.totalAmountMinor) + minor).toString();
      bucket.items.push(itemView);

      totalMinor += minor;
      sumProductDays += minor * BigInt(days);

      if (days < 0) {
        overdueCount += 1;
        overdueMinor += minor;
      } else if (days === 0) {
        todayCount += 1;
        todayMinor += minor;
      } else {
        upcomingCount += 1;
        upcomingMinor += minor;
      }

      // Bank grouping
      const bank = cheque.bankName || 'سایر / نامشخص';
      if (!bankAgg[bank]) bankAgg[bank] = { count: 0, totalMinor: 0n };
      bankAgg[bank].count += 1;
      bankAgg[bank].totalMinor += minor;

      // Party grouping
      const party = cheque.partyName || 'نامشخص';
      if (!partyAgg[party]) partyAgg[party] = { partyCode: cheque.partyCode, count: 0, totalMinor: 0n };
      partyAgg[party].count += 1;
      partyAgg[party].totalMinor += minor;

      // Sayad status
      const sayad = cheque.sayadRegistrationStatus || 'unknown';
      if (!sayadAgg[sayad]) sayadAgg[sayad] = { count: 0, totalMinor: 0n };
      sayadAgg[sayad].count += 1;
      sayadAgg[sayad].totalMinor += minor;
    }

    const weightedAvg = totalMinor > 0n ? Number(sumProductDays / totalMinor) : 0;

    const byBank: BankChequeMaturityView[] = Object.entries(bankAgg)
      .map(([bankName, agg]) => ({
        bankName,
        count: agg.count,
        totalAmountMinor: agg.totalMinor.toString(),
      }))
      .sort((a, b) => (BigInt(b.totalAmountMinor) > BigInt(a.totalAmountMinor) ? 1 : -1));

    const topParties: PartyChequeMaturityView[] = Object.entries(partyAgg)
      .map(([partyName, agg]) => ({
        partyName,
        partyCode: agg.partyCode,
        count: agg.count,
        totalAmountMinor: agg.totalMinor.toString(),
      }))
      .sort((a, b) => (BigInt(b.totalAmountMinor) > BigInt(a.totalAmountMinor) ? 1 : -1))
      .slice(0, 10);

    const bySayadStatus: Record<string, { count: number; totalAmountMinor: string }> = {};
    for (const [st, agg] of Object.entries(sayadAgg)) {
      bySayadStatus[st] = {
        count: agg.count,
        totalAmountMinor: agg.totalMinor.toString(),
      };
    }

    return {
      asOfDate,
      direction,
      currency: 'IRR',
      summary: {
        totalCount: filteredCheques.length,
        totalAmountMinor: totalMinor.toString(),
        overdueCount,
        overdueAmountMinor: overdueMinor.toString(),
        todayCount,
        todayAmountMinor: todayMinor.toString(),
        upcomingCount,
        upcomingAmountMinor: upcomingMinor.toString(),
        weightedAverageDays: weightedAvg,
      },
      buckets,
      byBank,
      topParties,
      bySayadStatus,
    };
  }
}
