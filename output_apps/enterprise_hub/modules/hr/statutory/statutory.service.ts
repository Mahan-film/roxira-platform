import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../access/services/audit.service';
import { isoDate, jalaliMonthEnd, jalaliMonthStart } from '../services/jalali-period';
import {
  isStatutoryKey,
  isValidStatutoryValue,
  STATUTORY_KEYS,
  StatutoryKey,
} from './statutory-catalogue';
import {
  StatutoryParameterEntity,
  StatutorySourceKind,
} from './statutory-parameter.entity';
import { StatutoryRepository } from './statutory.repository';
import { PayrollYearRates, TaxBracket } from './payroll-rates';

export const IRAN = 'IR';

export interface ResolvedParameter {
  key: StatutoryKey;
  label: string;
  value: unknown;
  effectiveFrom: string;
  version: number;
  source: string;
  sourceKind: StatutorySourceKind;
  verified: boolean;
  /** True when this organisation's own row is in force rather than the platform default. */
  tenantOverride: boolean;
}

/**
 * Picks the value in force on `asOf`: latest effective date not after it; on the same date the
 * tenant's row beats the platform default, and the highest version wins.
 */
export function resolveParameters(
  rows: StatutoryParameterEntity[],
  asOf: string,
): Map<StatutoryKey, StatutoryParameterEntity> {
  const resolved = new Map<StatutoryKey, StatutoryParameterEntity>();
  const beats = (a: StatutoryParameterEntity, b: StatutoryParameterEntity): boolean => {
    if (a.effectiveFrom !== b.effectiveFrom) {
      return a.effectiveFrom > b.effectiveFrom;
    }
    if ((a.tenantId === null) !== (b.tenantId === null)) {
      return a.tenantId !== null;
    }
    return a.version > b.version;
  };
  for (const row of rows) {
    if (!isStatutoryKey(row.paramKey) || row.effectiveFrom.slice(0, 10) > asOf) {
      continue;
    }
    const current = resolved.get(row.paramKey);
    if (!current || beats(row, current)) {
      resolved.set(row.paramKey, row);
    }
  }
  return resolved;
}

/** The payroll engine's view of resolved parameters. Throws if a required value is missing. */
export function toPayrollRates(
  year: number,
  parameters: Map<StatutoryKey, StatutoryParameterEntity>,
): PayrollYearRates {
  const missing = (Object.keys(STATUTORY_KEYS) as StatutoryKey[]).filter(
    (key) => STATUTORY_KEYS[key].required && !parameters.has(key),
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      `پارامترهای قانونی سال ${year} کامل نیست: ${missing
        .map((key) => STATUTORY_KEYS[key].label)
        .join('، ')}`,
    );
  }
  const raw = (key: StatutoryKey): unknown => parameters.get(key)?.value;
  const money = (key: StatutoryKey): number => Number(raw(key) ?? 0);
  const rate = (key: StatutoryKey): number => Number(raw(key) ?? 0);

  const days = money('payroll_month_days');
  const minDailyWage = money('min_daily_wage');
  const minMonthlyWage = minDailyWage * days;
  const annual = raw('wage_tax_annual_brackets') as {
    upTo: number | null;
    rate: string;
  }[];
  const taxBrackets: TaxBracket[] = annual.map((band) => ({
    upTo: band.upTo === null ? Number.POSITIVE_INFINITY : band.upTo / 12,
    rate: Number(band.rate),
  }));
  const unverified = [...parameters.values()]
    .filter((row) => !row.verified)
    .map((row) => row.paramKey);

  return {
    year,
    source: 'statutory_parameters',
    verified: unverified.length === 0,
    unverifiedKeys: unverified.sort(),
    minDailyWage,
    minMonthlyWage,
    housingAllowance: money('housing_allowance'),
    foodAllowance: money('food_allowance'),
    childAllowancePerChild: money('child_allowance_days') * minDailyWage,
    seniorityPerYear: money('seniority_daily') * days,
    monthlyWorkHours: money('monthly_work_hours'),
    payrollMonthDays: days,
    overtimePremium: rate('overtime_premium'),
    nightShiftPremium: rate('night_shift_premium'),
    holidayPremium: rate('holiday_premium'),
    employeeInsuranceRate: rate('employee_insurance_rate'),
    employerInsuranceRate: rate('employer_insurance_rate'),
    unemploymentInsuranceRate: rate('unemployment_insurance_rate'),
    maxInsurableMonthlyWage: minMonthlyWage * money('insurable_ceiling_multiplier'),
    taxBrackets,
  };
}

/** Reads and edits statutory values. Payroll takes every legal figure from here. */
@Injectable()
export class StatutoryService {
  constructor(
    private readonly repository: StatutoryRepository,
    private readonly audit: AuditService,
  ) {}

  /** Parameters in force at the end of a Jalali month (or year end when `month` is omitted). */
  private async inForce(
    tenantId: string,
    year: number,
    month: number,
  ): Promise<Map<StatutoryKey, StatutoryParameterEntity>> {
    const rows = await this.repository.findForYear(tenantId, IRAN, year);
    return resolveParameters(rows, isoDate(jalaliMonthEnd(year, month)));
  }

  async ratesFor(
    tenantId: string,
    year: number,
    month = 12,
  ): Promise<PayrollYearRates> {
    return toPayrollRates(year, await this.inForce(tenantId, year, month));
  }

  /**
   * Values of `year`, else of the closest earlier configured year, else of the earliest one.
   * For contract defaults and previews only; a payroll run needs its exact year.
   */
  async ratesForLatestUpTo(
    tenantId: string,
    year: number | undefined,
  ): Promise<PayrollYearRates> {
    const years = await this.repository.configuredYears(tenantId, IRAN);
    if (years.length === 0) {
      throw new BadRequestException('پارامترهای قانونی حقوق تعریف نشده است.');
    }
    const match =
      [...years].reverse().find((item) => year === undefined || item <= year) ??
      years[0];
    return this.ratesFor(tenantId, match);
  }

  /** Whether any parameter exists for this year (a run for an empty year is refused). */
  async hasYear(tenantId: string, year: number): Promise<boolean> {
    const rows = await this.repository.findForYear(tenantId, IRAN, year);
    return rows.length > 0;
  }

  async list(
    tenantId: string,
    year: number,
    month = 12,
  ): Promise<ResolvedParameter[]> {
    const parameters = await this.inForce(tenantId, year, month);
    return [...parameters.entries()].map(([key, row]) => ({
      key,
      label: STATUTORY_KEYS[key].label,
      value: row.value,
      effectiveFrom: row.effectiveFrom.slice(0, 10),
      version: row.version,
      source: row.source,
      sourceKind: row.sourceKind,
      verified: row.verified,
      tenantOverride: row.tenantId !== null,
    }));
  }

  /** Every version of one key, newest first, including superseded ones. */
  async history(
    tenantId: string,
    year: number,
    key: string,
  ): Promise<StatutoryParameterEntity[]> {
    if (!isStatutoryKey(key)) {
      throw new BadRequestException('کلید پارامتر قانونی معتبر نیست.');
    }
    const rows = await this.repository.findForYear(tenantId, IRAN, year);
    return rows.filter((row) => row.paramKey === key);
  }

  async setValue(
    tenantId: string,
    actorUserId: string,
    input: {
      fiscalYear: number;
      key: string;
      value: unknown;
      effectiveFrom?: string;
      source: string;
      verified: boolean;
    },
  ): Promise<ResolvedParameter[]> {
    const { key, fiscalYear } = input;
    if (!isStatutoryKey(key)) {
      throw new BadRequestException('کلید پارامتر قانونی معتبر نیست.');
    }
    if (!isValidStatutoryValue(key, input.value)) {
      throw new BadRequestException(
        `مقدار «${STATUTORY_KEYS[key].label}» با نوع آن سازگار نیست.`,
      );
    }
    const yearStart = isoDate(jalaliMonthStart(fiscalYear, 1));
    const yearEnd = isoDate(jalaliMonthEnd(fiscalYear, 12));
    const effectiveFrom = input.effectiveFrom ?? yearStart;
    if (effectiveFrom < yearStart || effectiveFrom > yearEnd) {
      throw new BadRequestException('تاریخ نفوذ باید در همان سال مالی باشد.');
    }

    const before = (await this.history(tenantId, fiscalYear, key))[0] ?? null;
    const row = await this.repository.insertVersion(tenantId, {
      country: IRAN,
      fiscalYear,
      paramKey: key,
      effectiveFrom,
      value: input.value,
      source: input.source,
      sourceKind: StatutorySourceKind.TENANT,
      verified: input.verified,
      createdBy: actorUserId,
    });
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'statutory.parameter.set',
      resourceType: 'statutory_parameter',
      resourceId: row.id,
      metadata: {
        key,
        fiscalYear,
        effectiveFrom,
        version: row.version,
        previousValue: before?.value ?? null,
        value: input.value,
        verified: input.verified,
      },
    });
    return this.list(tenantId, fiscalYear);
  }
}
