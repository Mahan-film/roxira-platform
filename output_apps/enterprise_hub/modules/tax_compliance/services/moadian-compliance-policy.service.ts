import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { PolicyService } from '../../tenants/policy/policy.service';
import {
  MoadianArticle6ReportDto,
  MoadianInboxAgeReportDto,
  MoadianInboxAlertItemDto,
} from '../dto/moadian-compliance.dto';
import { formatJalaliYmd } from '../reports/jalali-format.util';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';

/**
 * Statutory default quarterly baseline for Article 6 sales cap (5x Article 101 exemption).
 * In 1405: 5 * 1,440,000,000 Rials annual base = 7,200,000,000 Rials.
 */
export const STATUTORY_DEFAULT_ARTICLE_6_CEILING_RIAL = 7_200_000_000n;

@Injectable()
export class MoadianCompliancePolicyService {
  constructor(
    private readonly scope: TenantScope,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * Inspects pending/unconfirmed purchase invoices in the Moadian inbox and flags
   * invoices older than warn_days (default: 20) and critical_days (default: 27)
   * before statutory automatic acceptance on day 30 (تبصره ماده ۵ قانون پایانه‌های فروشگاهی).
   */
  async checkInboxAge(
    tenantId: string,
    options?: { asOf?: Date | string },
  ): Promise<MoadianInboxAgeReportDto> {
    const asOf = options?.asOf ? new Date(options.asOf) : new Date();

    const mode = (await this.policyService.get(
      tenantId,
      'moadian.inbox_age_alert.mode',
    )) as 'refuse' | 'warn' | 'off';

    const warnDays = Number(
      await this.policyService.get(tenantId, 'moadian.inbox_age_alert.warn_days'),
    );

    const criticalDays = Number(
      await this.policyService.get(tenantId, 'moadian.inbox_age_alert.critical_days'),
    );

    if (mode === 'off') {
      return {
        mode: 'off',
        warnDays,
        criticalDays,
        totalPending: 0,
        warningCount: 0,
        criticalCount: 0,
        hasCritical: false,
        hasWarning: false,
        alerts: [],
      };
    }

    return this.scope.run(tenantId, async (manager) => {
      const rows = (await manager.query(
        `SELECT "id", "taxInvoiceNumber" AS "tax_invoice_number", "issued_at", "createdAt" AS "created_at",
                "finalPayable" AS "final_payable", "sellerInfo" AS "seller_info"
         FROM "invoices"
         WHERE "tenant_id" = $1
           AND "direction" = 'PURCHASE'
           AND "status" IN ('DRAFT', 'ISSUED')
           AND "paid_at" IS NULL
         ORDER BY COALESCE("issued_at", "createdAt") ASC`,
        [tenantId],
      )) as Array<{
        id: string;
        tax_invoice_number: string;
        issued_at: Date | string | null;
        created_at: Date | string;
        final_payable: number | string;
        seller_info?: { name?: string } | null;
      }>;

      const alerts: MoadianInboxAlertItemDto[] = [];
      let warningCount = 0;
      let criticalCount = 0;

      for (const row of rows) {
        const docDate = row.issued_at ? new Date(row.issued_at) : new Date(row.created_at);
        const ageMs = asOf.getTime() - docDate.getTime();
        const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
        const remainingDays = Math.max(0, 30 - ageDays);

        let severity: 'ok' | 'warn' | 'critical' = 'ok';
        let messageFa = `صورتحساب عادی (${ageDays} روز از درج در کارپوشه).`;

        if (ageDays >= criticalDays) {
          severity = 'critical';
          criticalCount++;
          messageFa = `هشدار بحرانی: صورتحساب شماره «${row.tax_invoice_number}» به مدت ${ageDays} روز بدون تعیین‌تکلیف مانده است (تنها ${remainingDays} روز تا تأیید خودکار قطعی سامانه مؤدیان باقی است).`;
        } else if (ageDays >= warnDays) {
          severity = 'warn';
          warningCount++;
          messageFa = `هشدار: صورتحساب شماره «${row.tax_invoice_number}» به مدت ${ageDays} روز در کارپوشه بدون تأیید یا رد مانده است (آستانه هشدار: ${warnDays} روز).`;
        }

        alerts.push({
          invoiceId: row.id,
          taxInvoiceNumber: row.tax_invoice_number,
          invoiceDate: docDate.toISOString().slice(0, 10),
          ageDays,
          remainingDaysToAutoAccept: remainingDays,
          severity,
          messageFa,
          sellerName: row.seller_info?.name,
          amountRial: String(Math.round(Number(row.final_payable))),
        });
      }

      return {
        mode,
        warnDays,
        criticalDays,
        totalPending: rows.length,
        warningCount,
        criticalCount,
        hasCritical: criticalCount > 0,
        hasWarning: warningCount > 0,
        alerts,
      };
    });
  }

  /**
   * Checks current quarter sales volume against the statutory Article 6 ceiling
   * (سقف مجاز صدور صورتحساب ماده ۶ قانون پایانه‌های فروشگاهی و تسهیل).
   * Issues proactive advisory warnings at 80% (configurable via policy) and warns/blocks at 100%.
   */
  async checkArticle6SalesCap(
    tenantId: string,
    options?: {
      newSalesAmountRial?: number | bigint;
      fiscalYear?: number;
      quarter?: number;
      asOf?: Date | string;
    },
  ): Promise<MoadianArticle6ReportDto> {
    const asOf = options?.asOf ? new Date(options.asOf) : new Date();

    const mode = (await this.policyService.get(
      tenantId,
      'moadian.article_6_cap.mode',
    )) as 'refuse' | 'warn' | 'off';

    const warningPercent = Number(
      await this.policyService.get(tenantId, 'moadian.article_6_cap.warning_percent'),
    );

    const customCeiling = BigInt(
      (await this.policyService.get(tenantId, 'moadian.article_6_cap.custom_ceiling_rial')) as number,
    );

    // Resolve fiscal quarter
    let year = options?.fiscalYear;
    let quarter = options?.quarter;
    if (!year || !quarter) {
      const jalaliStr = formatJalaliYmd(asOf); // e.g. "1405/08/18"
      const parts = jalaliStr.split('/').map(Number);
      year = parts[0];
      const month = parts[1];
      quarter = Math.min(4, Math.max(1, Math.ceil(month / 3)));
    }

    const range = jalaliQuarterRange(year, quarter);
    const ceilingRial = customCeiling > 0n ? customCeiling : STATUTORY_DEFAULT_ARTICLE_6_CEILING_RIAL;

    if (mode === 'off') {
      return {
        mode: 'off',
        warningPercent,
        fiscalYear: year,
        quarter,
        quarterLabel: range.label,
        currentSalesRial: '0',
        newSalesRial: String(options?.newSalesAmountRial ?? 0),
        projectedSalesRial: String(options?.newSalesAmountRial ?? 0),
        ceilingRial: ceilingRial.toString(),
        utilizationPercent: 0,
        isWarning: false,
        isExceeded: false,
        warningMessage: null,
        allowed: true,
      };
    }

    return this.scope.run(tenantId, async (manager) => {
      const result = (await manager.query(
        `SELECT COALESCE(SUM("finalPayable"), 0) AS "total_sales"
         FROM "invoices"
         WHERE "tenant_id" = $1
           AND "direction" = 'SALE'
           AND "status" IN ('ISSUED', 'PAID')
           AND (
             ("issued_at" >= $2 AND "issued_at" < $3)
             OR ("issued_at" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3)
           )`,
        [tenantId, range.from, range.to],
      )) as Array<{ total_sales: number | string }>;

      const currentSales = BigInt(Math.round(Number(result[0]?.total_sales ?? 0)));
      const newSales = BigInt(Math.round(Number(options?.newSalesAmountRial ?? 0)));
      const projected = currentSales + newSales;

      const utilizationPercent =
        ceilingRial > 0n ? Math.round(Number((projected * 10000n) / ceilingRial) / 100) : 100;

      const isExceeded = projected >= ceilingRial;
      const isWarning = utilizationPercent >= warningPercent;

      let warningMessage: string | null = null;
      let allowed = true;

      if (isExceeded) {
        warningMessage =
          'سقف مجاز صدور صورتحساب ماده ۶ تکمیل شده است. خریداران ممکن است مشمول عدم اعتبار مالیاتی ارزش افزوده شوند.';
        if (mode === 'refuse') {
          allowed = false;
        }
      } else if (isWarning) {
        warningMessage = `هشدار سقف فروش ماده ۶: میزان فروش دوره به ${utilizationPercent}٪ سقف مجاز مصوب رسیده است (آستانه هشدار: ${warningPercent}٪).`;
      }

      return {
        mode,
        warningPercent,
        fiscalYear: year,
        quarter,
        quarterLabel: range.label,
        currentSalesRial: currentSales.toString(),
        newSalesRial: newSales.toString(),
        projectedSalesRial: projected.toString(),
        ceilingRial: ceilingRial.toString(),
        utilizationPercent,
        isWarning,
        isExceeded,
        warningMessage,
        allowed,
      };
    });
  }

  /**
   * Asserts whether a prospective sales invoice can be issued under the tenant's Article 6 policy.
   * Throws BadRequestException if policy mode is 'refuse' and authorized ceiling is exceeded.
   */
  async assertCanIssueInvoice(
    tenantId: string,
    invoiceAmountRial: number | bigint,
    options?: { asOf?: Date | string; fiscalYear?: number; quarter?: number },
  ): Promise<void> {
    const report = await this.checkArticle6SalesCap(tenantId, {
      newSalesAmountRial: invoiceAmountRial,
      ...options,
    });

    if (!report.allowed) {
      throw new BadRequestException(
        report.warningMessage ?? 'سقف مجاز صدور صورتحساب ماده ۶ برای دوره جاری تکمیل شده است.',
      );
    }
  }
}
