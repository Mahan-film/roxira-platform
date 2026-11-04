import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { gregorianToJalali } from '../../hr/services/jalali-period';
import { isValidStatutoryValue } from '../../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';

export const VAT_GENERAL_RATE_KEY = 'vat_general_rate';

export type VatRateSource = 'statutory';

export interface ResolvedVatRate {
  /** Fraction, e.g. 0.1 for 10%. */
  rate: number;
  source: VatRateSource;
}

/**
 * The general VAT rate in force on an invoice date. No rate lives in code.
 *
 * The only source is `statutory_parameters.vat_general_rate` in force on that date (Jalali
 * fiscal year of the date, latest effective date not after it). An organisation that needs a
 * different rate adds its own row to the store; that row beats the platform default (see
 * `resolveParameters`).
 *
 * When no row covers the date the invoice is refused with a clear error (#126). There is no
 * fallback: `tenants.default_vat_rate` is deprecated and never read here, because its column
 * default (0.1) would silently turn into a code value.
 *
 * An explicit rate on an invoice line is applied by the caller and is never replaced here.
 */
@Injectable()
export class VatRateResolver {
  constructor(@Optional() private readonly statutory?: StatutoryRepository) {}

  /** `onDate` is a Gregorian ISO date (`YYYY-MM-DD`). */
  async generalRate(tenantId: string, onDate: string): Promise<ResolvedVatRate> {
    const jalali = gregorianToJalali(onDate);
    if (!jalali) {
      throw new BadRequestException(`تاریخ صورتحساب نامعتبر است: ${onDate}`);
    }
    const rate = await this.fromStatutoryStore(tenantId, onDate, jalali.jy);
    if (rate === null) {
      throw new BadRequestException(
        `نرخ عمومی مالیات بر ارزش افزوده برای تاریخ ${onDate} (سال ${jalali.jy}) در پارامترهای قانونی تعریف نشده است. ` +
          'نرخ این سال را در پارامترهای قانونی ثبت کنید یا نرخ را روی سطرهای صورتحساب وارد کنید.',
      );
    }
    return { rate, source: 'statutory' };
  }

  private async fromStatutoryStore(
    tenantId: string,
    onDate: string,
    fiscalYear: number,
  ): Promise<number | null> {
    if (!this.statutory) {
      return null;
    }
    const rows = await this.statutory.findForYear(tenantId, IRAN, fiscalYear);
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
}
