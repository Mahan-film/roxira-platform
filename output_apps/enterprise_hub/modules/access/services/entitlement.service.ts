import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TenantScope } from './tenant-scope';

export const USAGE_METERS = [
  'ai_messages',
  'ocr_pages',
  'voice_minutes',
  'branches',
  'office_users',
  'payroll_employees',
] as const;

export type UsageMeter = (typeof USAGE_METERS)[number];

const MONTHLY_METERS = new Set<UsageMeter>(['ai_messages', 'ocr_pages', 'voice_minutes']);

export interface PlanConfig {
  defaultPlan: string;
  plans: Record<string, Partial<Record<UsageMeter, number>>>;
}

export interface EntitlementCheckResult {
  allowed: boolean;
  meter: UsageMeter;
  periodKey: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface EntitlementConsumeResult {
  meter: UsageMeter;
  periodKey: string;
  used: number;
  limit: number;
  remaining: number;
}

export function computePeriodKey(meter: UsageMeter, now: Date, rolloverDay = 1): string {
  if (!MONTHLY_METERS.has(meter)) {
    return 'current';
  }
  const day = Math.min(28, Math.max(1, Math.floor(rolloverDay)));
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1..12
  if (now.getUTCDate() < day) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function loadPlanConfig(): PlanConfig {
  const candidates = [
    path.resolve(process.cwd(), 'config/plans.json'),
    path.resolve(process.cwd(), '../../config/plans.json'),
    path.resolve(__dirname, '../../../../../config/plans.json'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PlanConfig;
    }
  }
  throw new Error('Plan configuration file config/plans.json not found.');
}

/**
 * Plan entitlements and usage metering service (T145).
 * Enforces per-tenant monthly and capacity limits backed by tenant_plans and usage_counters.
 */
@Injectable()
export class EntitlementService implements OnModuleInit {
  private readonly logger = new Logger(EntitlementService.name);
  private planConfig: PlanConfig | null = null;

  constructor(private readonly scope: TenantScope) {}

  onModuleInit(): void {
    this.getPlanConfig();
  }

  private getPlanConfig(): PlanConfig {
    if (!this.planConfig) {
      this.planConfig = loadPlanConfig();
    }
    return this.planConfig;
  }

  private assertMeter(meter: string): asserts meter is UsageMeter {
    if (!USAGE_METERS.includes(meter as UsageMeter)) {
      throw new BadRequestException(`Unknown usage meter: ${meter}`);
    }
  }

  private resolveLimit(planKey: string, overrides: Record<string, unknown> | null, meter: UsageMeter): number {
    const planLimits = this.getPlanConfig().plans[planKey];
    if (!planLimits) {
      throw new ForbiddenException(`Unknown tenant plan "${planKey}"; access denied.`);
    }
    const override = overrides && typeof overrides[meter] === 'number' ? (overrides[meter] as number) : undefined;
    const rawLimit = override ?? planLimits[meter];
    if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit) || rawLimit < 0) {
      throw new ForbiddenException(`No valid limit configured for meter "${meter}" on plan "${planKey}".`);
    }
    return Math.floor(rawLimit);
  }

  async setPlan(
    tenantId: string,
    planKey: string,
    limits: Partial<Record<UsageMeter, number>> = {},
    rolloverDay = 1,
  ): Promise<void> {
    if (!this.getPlanConfig().plans[planKey]) {
      throw new BadRequestException(`Unknown plan key: ${planKey}`);
    }
    if (!Number.isInteger(rolloverDay) || rolloverDay < 1 || rolloverDay > 28) {
      throw new BadRequestException('rolloverDay must be an integer between 1 and 28.');
    }
    await this.scope.within(tenantId, undefined, async (manager) => {
      await manager.query(
        `INSERT INTO tenant_plans (tenant_id, plan_key, limits, rollover_day)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (tenant_id) DO UPDATE
           SET plan_key = EXCLUDED.plan_key,
               limits = EXCLUDED.limits,
               rollover_day = EXCLUDED.rollover_day,
               updated_at = now()`,
        [tenantId, planKey, JSON.stringify(limits), rolloverDay],
      );
    });
  }

  async check(
    tenantId: string,
    meter: UsageMeter,
    n = 1,
    now: Date = new Date(),
  ): Promise<EntitlementCheckResult> {
    this.assertMeter(meter);
    if (!Number.isInteger(n) || n < 0) {
      throw new BadRequestException('Usage check quantity must be a non-negative integer.');
    }

    return this.scope.within(tenantId, undefined, async (manager) => {
      const planRows = (await manager.query(
        `SELECT plan_key, limits, rollover_day FROM tenant_plans WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      )) as Array<{ plan_key: string; limits: Record<string, unknown>; rollover_day: number }>;

      if (!planRows[0]) {
        throw new ForbiddenException('No plan assigned to tenant.');
      }
      const planKey = planRows[0].plan_key;
      const overrides = planRows[0].limits ?? null;
      const rolloverDay = planRows[0].rollover_day ?? 1;
      const limit = this.resolveLimit(planKey, overrides, meter);
      const periodKey = computePeriodKey(meter, now, rolloverDay);

      const counterRows = (await manager.query(
        `SELECT used FROM usage_counters WHERE tenant_id = $1 AND meter = $2 AND period_key = $3 LIMIT 1`,
        [tenantId, meter, periodKey],
      )) as Array<{ used: string | number }>;

      let used = counterRows[0] ? Number(counterRows[0].used) : 0;
      if (!counterRows[0] && meter === 'branches') {
        const branchCountRows = (await manager.query(
          `SELECT COUNT(*)::bigint AS used FROM tenant_branches WHERE tenant_id = $1`,
          [tenantId],
        )) as Array<{ used: string | number }>;
        used = branchCountRows[0] ? Number(branchCountRows[0].used) : 0;
      }
      const allowed = used + n <= limit;
      return {
        allowed,
        meter,
        periodKey,
        used,
        limit,
        remaining: Math.max(0, limit - used),
      };
    });
  }

  async consume(
    tenantId: string,
    meter: UsageMeter,
    n = 1,
    now: Date = new Date(),
  ): Promise<EntitlementConsumeResult> {
    this.assertMeter(meter);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException('Usage consume quantity must be a positive integer.');
    }

    return this.scope.within(tenantId, undefined, async (manager) => {
      const planRows = (await manager.query(
        `SELECT plan_key, limits, rollover_day FROM tenant_plans WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      )) as Array<{ plan_key: string; limits: Record<string, unknown>; rollover_day: number }>;

      if (!planRows[0]) {
        throw new ForbiddenException('No plan assigned to tenant.');
      }
      const planKey = planRows[0].plan_key;
      const overrides = planRows[0].limits ?? null;
      const rolloverDay = planRows[0].rollover_day ?? 1;
      const limit = this.resolveLimit(planKey, overrides, meter);
      const periodKey = computePeriodKey(meter, now, rolloverDay);

      if (meter === 'branches') {
        await manager.query(
          `INSERT INTO usage_counters (tenant_id, meter, period_key, used)
           VALUES ($1, $2, $3, (SELECT COUNT(*)::bigint FROM tenant_branches WHERE tenant_id = $1))
           ON CONFLICT (tenant_id, meter, period_key) DO NOTHING`,
          [tenantId, meter, periodKey],
        );
      } else {
        await manager.query(
          `INSERT INTO usage_counters (tenant_id, meter, period_key, used)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT (tenant_id, meter, period_key) DO NOTHING`,
          [tenantId, meter, periodKey],
        );
      }

      const rawUpdate = await manager.query(
        `UPDATE usage_counters
            SET used = used + $4, updated_at = now()
          WHERE tenant_id = $1
            AND meter = $2
            AND period_key = $3
            AND used + $4 <= $5
          RETURNING used`,
        [tenantId, meter, periodKey, n, limit],
      );
      const updated = (Array.isArray(rawUpdate[0]) ? rawUpdate[0] : rawUpdate) as Array<{ used: string | number }>;

      if (updated.length === 0) {
        throw new HttpException(
          `Usage limit reached for ${meter} (limit: ${limit}).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const used = Number(updated[0].used);
      return {
        meter,
        periodKey,
        used,
        limit,
        remaining: Math.max(0, limit - used),
      };
    });
  }

  async release(
    tenantId: string,
    meter: UsageMeter,
    n = 1,
    now: Date = new Date(),
  ): Promise<void> {
    this.assertMeter(meter);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException('Usage release quantity must be a positive integer.');
    }

    await this.scope.within(tenantId, undefined, async (manager) => {
      const planRows = (await manager.query(
        `SELECT rollover_day FROM tenant_plans WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      )) as Array<{ rollover_day: number }>;
      const periodKey = computePeriodKey(meter, now, planRows[0]?.rollover_day ?? 1);
      const rawReleased = await manager.query(
        `UPDATE usage_counters
            SET used = GREATEST(0, used - $4), updated_at = now()
          WHERE tenant_id = $1 AND meter = $2 AND period_key = $3
          RETURNING meter`,
        [tenantId, meter, periodKey, n],
      );
      const released = Array.isArray(rawReleased) && Array.isArray(rawReleased[0])
        ? (rawReleased[0] as Array<{ meter: string }>)
        : (rawReleased as Array<{ meter: string }>);
      if (released.length === 0) {
        if (meter === 'branches') {
          // If no counter row existed yet (e.g. deleting a pre-existing branch),
          // seed directly from the post-delete live count without subtracting n again.
          await manager.query(
            `INSERT INTO usage_counters (tenant_id, meter, period_key, used)
             VALUES ($1, $2, $3, (SELECT COUNT(*)::bigint FROM tenant_branches WHERE tenant_id = $1))
             ON CONFLICT (tenant_id, meter, period_key) DO NOTHING`,
            [tenantId, meter, periodKey],
          );
        } else {
          this.logger.warn(`release(${meter}) for tenant ${tenantId} period ${periodKey} affected 0 usage_counters rows`);
        }
      }
    });
  }
}
