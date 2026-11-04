import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { gregorianToJalali } from '../../hr/services/jalali-period';
import { isValidStatutoryValue } from '../../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';

export const VAT_GENERAL_RATE_KEY = 'vat_general_rate';

export type VatRateSource = 'statutory' | 'tenant_setting';

export interface ResolvedVatRate {
  /** Fraction, e.g. 0.1 for 10%. */
  rate: number;
  source: VatRateSource;
}

/**
 * The general VAT rate in force on an invoice date. No rate lives in code.
 *
 * Order:
 *   1. `statutory_parameters.vat_general_rate` in force on that date (Jalali fiscal year of the
 *      date, latest effective date not after it). An organisation's own row in the store beats
 *      the platform default (see `resolveParameters`).
 *   2. If the store holds no value for that date: the organisation setting
 *      `tenants.default_vat_rate`, as the invoicing code did before the store existed.
 *   3. Neither: the invoice is refused with a clear error.
 *
 * An explicit rate on an invoice line is applied by the caller and is never replaced here.
 */
@Injectable()
export class VatRateResolver {
  constructor(
    @Optional() private readonly statutory?: StatutoryRepository,
    @Optional() private readonly tenants?: TenantsRepository,
  ) {}

  /** `onDate` is a Gregorian ISO date (`YYYY-MM-DD`). */
  async generalRate(tenantId: string, onDate: string): Promise<ResolvedVatRate> {
    const fromStore = await this.fromStatutoryStore(tenantId, onDate);
    if (fromStore !== null) {
      return { rate: fromStore, source: 'statutory' };
    }
    const fromTenant = await this.fromTenantSetting(tenantId);
    if (fromTenant !== null) {
      return { rate: fromTenant, source: 'tenant_setting' };
    }
    throw new BadRequestException(
      `نرخ عمومی مالیات بر ارزش افزوده برای تاریخ ${onDate} در پارامترهای قانونی تعریف نشده است.`,
    );
  }

  private async fromStatutoryStore(tenantId: string, onDate: string): Promise<number | null> {
    if (!this.statutory) {
      return null;
    }
    const jalali = gregorianToJalali(onDate);
    if (!jalali) {
      throw new BadRequestException(`تاریخ صورتحساب نامعتبر است: ${onDate}`);
    }
    const rows = await this.statutory.findForYear(tenantId, IRAN, jalali.jy);
    const row = resolveParameters(rows, onDate.slice(0, 10)).get(VAT_GENERAL_RATE_KEY);
    if (!row) {
      return null;
    }
    if (!isValidStatutoryValue(VAT_GENERAL_RATE_KEY, row.value)) {
      throw new BadRequestException(
        `مقدار پارامتر قانونی نرخ مالیات بر ارزش افزوده (نسخه ${row.version}) نامعتبر است.`,
      );
    }
    return Number(row.value);
  }

  private async fromTenantSetting(tenantId: string): Promise<number | null> {
    if (!this.tenants) {
      return null;
    }
    const value =
      typeof this.tenants.findDefaultVatRate === 'function'
        ? await this.tenants.findDefaultVatRate(tenantId)
        : (await this.tenants.findById(tenantId))?.defaultVatRate;
    if (value === undefined || value === null) {
      return null;
    }
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 ? rate : null;
  }
}
