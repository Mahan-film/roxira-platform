import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { EntityManager } from 'typeorm';
import { AuditService } from '../../access/services/audit.service';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  POLICY_REGISTRY,
  PolicyDefinition,
  PolicyGroup,
  PolicyType,
  PolicyValue,
  getPolicyDefinition,
  getWeakeningWarning,
  isPolicyWeakened,
  validatePolicyValue,
} from './policy.registry';

export interface PolicyActor {
  userId: string;
  roleKey: string;
}

/** One row of GET /policies: the definition plus the caller's current value and its provenance. */
export interface PolicyView {
  key: string;
  group: PolicyGroup;
  type: PolicyType;
  allowed: PolicyDefinition['allowed'];
  default: PolicyValue;
  labelFa: string;
  descriptionFa: string;
  value: PolicyValue;
  isDefault: boolean;
  /** Set for a stored value; null for a fixed key or a value that was never written. */
  updatedAt: Date | null;
  updatedBy: string | null;
  editable: boolean;
  /** True when the current value weakens internal control or ledger protection (#584-6) */
  isWeakened: boolean;
  /** Warning message explaining the control risk when turned off or weakened (#584-6) */
  warning: string | null;
  /** Scheduled auto-revert date to the safe default (#584-6) */
  autoRevertAt: Date | null;
  /** Written reason for deviation (#584-6) */
  reason: string | null;
}

/** Stored metadata row from tenant_policy_settings */
interface StoredPolicyMeta {
  updatedAt: Date | null;
  updatedBy: string | null;
  autoRevertAt: Date | null;
  reason: string | null;
}

/** Group C price tolerances live in the existing purchase-settings columns, not in the policy table. */
const PURCHASE_SETTINGS_COLUMNS: Readonly<Record<string, string>> = {
  'purchase.three_way.price_tolerance_bp': 'price_tolerance_bp',
  'purchase.three_way.price_tolerance_abs': 'price_tolerance_abs',
};

const REASON_MIN_C = 5;
const REASON_MIN_B = 15;

/**
 * Reads and writes the tenant policy settings. All raw SQL runs inside a TenantScope transaction
 * (the tables have FORCE row-level security); there is no TypeORM entity for the policy table.
 *
 * `erp_purchase_settings` is written with the same upsert semantics as `PurchaseRepository.upsertSettings`,
 * without importing the inventory module: a change to one price tolerance leaves the other columns
 * of that row untouched, and a missing row falls back to the defaults.
 */
@Injectable()
export class PolicyService {
  constructor(
    private readonly scope: TenantScope,
    private readonly audit: AuditService,
  ) {}

  /** Current value of one key (stored value or the registry default). Reverts expired controls first. */
  async get(tenantId: string, key: string, manager?: EntityManager): Promise<PolicyValue> {
    const definition = getPolicyDefinition(key);
    if (!definition) throw new NotFoundException(`قاعدهٔ «${key}» شناخته‌شده نیست.`);
    return this.scope.within(tenantId, manager, async (m) => {
      await this.revertExpired(tenantId, m);
      return this.readValue(tenantId, definition, m);
    });
  }

  /** Every definition with its group, type, allowed values, default and current value. */
  getAll(tenantId: string, options?: { exceptionsOnly?: boolean }): Promise<PolicyView[]> {
    return this.scope.run(tenantId, async (manager) => {
      await this.revertExpired(tenantId, manager);

      const storedRows = (await manager.query(
        `SELECT "key", "value", "updated_by", "updated_at", "auto_revert_at", "reason" FROM "tenant_policy_settings" WHERE "tenant_id" = $1`,
        [tenantId],
      )) as Array<{ key: string; value: unknown; updated_by: string; updated_at: Date; auto_revert_at: Date | null; reason: string | null }>;
      const stored = new Map(storedRows.map((row) => [String(row.key), row]));

      const purchaseRows = (await manager.query(
        `SELECT "price_tolerance_bp", "price_tolerance_abs", "updated_at" FROM "erp_purchase_settings" WHERE "tenant_id" = $1`,
        [tenantId],
      )) as Array<Record<string, unknown>>;
      const purchase = purchaseRows[0];

      const all = POLICY_REGISTRY.map((definition) => {
        if (definition.store) {
          const value = purchase
            ? this.coerce(definition, purchase[PURCHASE_SETTINGS_COLUMNS[definition.key]])
            : definition.default;
          return this.view(
            definition,
            value,
            purchase ? { updatedAt: toDate(purchase.updated_at), updatedBy: null, autoRevertAt: null, reason: null } : null,
          );
        }
        const row = stored.get(definition.key);
        if (row) {
          return this.view(definition, this.coerce(definition, row.value), {
            updatedAt: toDate(row.updated_at),
            updatedBy: String(row.updated_by),
            autoRevertAt: row.auto_revert_at ? toDate(row.auto_revert_at) : null,
            reason: row.reason ? String(row.reason) : null,
          });
        }
        return this.view(definition, definition.default, null);
      });

      if (options?.exceptionsOnly) {
        return all.filter((p) => !p.isDefault || p.isWeakened);
      }
      return all;
    });
  }

  /** Returns all policies currently differing from safe default or weakened (#584-6 exceptions report). */
  async getExceptions(tenantId: string): Promise<PolicyView[]> {
    return this.getAll(tenantId, { exceptionsOnly: true });
  }

  /**
   * Sets one policy value. Rules are checked in this order: unknown key (404), fixed group A (403),
   * actor must be owner or admin (403), value validity (400), reason length (400), future auto-revert date (400),
   * then a no-op when the value is unchanged. A real change writes the value and appends one audit row in the same
   * transaction (action `policy.changed`, or `policy.changed.protected` for group B).
   */
  async set(
    tenantId: string,
    actor: PolicyActor,
    key: string,
    value: PolicyValue,
    reason: string,
    autoRevertAt?: string | Date | null,
    request?: Pick<Request, 'ip' | 'headers'>,
  ): Promise<PolicyView> {
    const definition = getPolicyDefinition(key);
    if (!definition) throw new NotFoundException(`قاعدهٔ «${key}» شناخته‌شده نیست.`);
    if (definition.group === 'A') throw new ForbiddenException('این قاعده ثابت است');
    if (actor.roleKey !== 'owner' && actor.roleKey !== 'admin') {
      throw new ForbiddenException('فقط مالک یا مدیر سازمان می‌تواند قواعد را تغییر دهد.');
    }

    const check = validatePolicyValue(key, value);
    if (!check.ok) throw new BadRequestException(check.error);

    const minLength = definition.group === 'B' ? REASON_MIN_B : REASON_MIN_C;
    const trimmed = String(reason ?? '').trim();
    if (trimmed.length < minLength) {
      throw new BadRequestException(`دلیل تغییر باید دست‌کم ${minLength} نویسه باشد.`);
    }

    let revertDate: Date | null = null;
    if (autoRevertAt) {
      revertDate = typeof autoRevertAt === 'string' ? new Date(autoRevertAt) : autoRevertAt;
      if (Number.isNaN(revertDate.getTime()) || revertDate.getTime() <= Date.now()) {
        throw new BadRequestException('تاریخ بازگشت خودکار باید در آینده باشد.');
      }
    }

    return this.scope.run(tenantId, async (manager) => {
      const current = await this.readValue(tenantId, definition, manager);
      if (current === value && !revertDate) return this.view(definition, current, null);

      await this.writeValue(tenantId, definition, value, actor.userId, revertDate, trimmed, manager);
      const isWeakened = isPolicyWeakened(key, value);
      const warning = getWeakeningWarning(key, value);

      await this.audit.record(
        {
          tenantId,
          actorUserId: actor.userId,
          action: definition.group === 'B' ? 'policy.changed.protected' : 'policy.changed',
          resourceType: 'tenant_policy',
          resourceId: key,
          metadata: {
            key,
            group: definition.group,
            oldValue: current,
            newValue: value,
            reason: trimmed,
            isWeakened,
            warning,
            autoRevertAt: revertDate,
          },
          request,
        },
        manager,
      );
      return this.view(definition, value, {
        updatedAt: new Date(),
        updatedBy: actor.userId,
        autoRevertAt: revertDate,
        reason: trimmed,
      });
    });
  }

  /**
   * Reverts any policies whose auto_revert_at date has passed, back to safe defaults (#584-6).
   */
  async revertExpired(tenantId: string, outerManager?: EntityManager): Promise<number> {
    return this.scope.within(tenantId, outerManager, async (manager) => {
      const expiredRows = (await manager.query(
        `SELECT "key", "value", "updated_by", "auto_revert_at", "reason"
         FROM "tenant_policy_settings"
         WHERE "tenant_id" = $1 AND "auto_revert_at" IS NOT NULL AND "auto_revert_at" <= now()`,
        [tenantId],
      )) as Array<{ key: string; value: unknown; updated_by: string; auto_revert_at: Date; reason: string | null }>;

      if (!expiredRows || expiredRows.length === 0) return 0;

      for (const row of expiredRows) {
        const def = getPolicyDefinition(row.key);
        if (!def) continue;

        await manager.query(
          `UPDATE "tenant_policy_settings"
           SET "value" = $3::jsonb,
               "auto_revert_at" = NULL,
               "updated_at" = now(),
               "reason" = $4
           WHERE "tenant_id" = $1 AND "key" = $2`,
          [
            tenantId,
            row.key,
            JSON.stringify(def.default),
            `بازگشت خودکار به مقدار پیش‌فرض امن (${def.default}) پس از انقضای مهلت`,
          ],
        );

        await this.audit.record(
          {
            tenantId,
            actorUserId: 'system:auto-revert',
            action: 'policy.auto_reverted',
            resourceType: 'tenant_policy',
            resourceId: row.key,
            metadata: {
              key: row.key,
              group: def.group,
              revertedFrom: row.value,
              revertedTo: def.default,
              expiredAutoRevertAt: row.auto_revert_at,
            },
          },
          manager,
        );
      }
      return expiredRows.length;
    });
  }

  // ------------------------------------------------------------------ internals

  private async readValue(
    tenantId: string,
    definition: PolicyDefinition,
    manager: EntityManager,
  ): Promise<PolicyValue> {
    if (definition.store) {
      const column = PURCHASE_SETTINGS_COLUMNS[definition.key];
      const rows = (await manager.query(
        `SELECT "${column}" AS v FROM "erp_purchase_settings" WHERE "tenant_id" = $1`,
        [tenantId],
      )) as Array<{ v: unknown }>;
      return rows[0] ? this.coerce(definition, rows[0].v) : definition.default;
    }

    const rows = (await manager.query(
      `SELECT "value" AS v FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = $2`,
      [tenantId, definition.key],
    )) as Array<{ v: unknown }>;
    return rows[0] ? this.coerce(definition, rows[0].v) : definition.default;
  }

  private async writeValue(
    tenantId: string,
    definition: PolicyDefinition,
    value: PolicyValue,
    userId: string,
    autoRevertAt: Date | null,
    reason: string | null,
    manager: EntityManager,
  ): Promise<void> {
    if (definition.store) {
      const column = PURCHASE_SETTINGS_COLUMNS[definition.key];
      const rows = (await manager.query(
        `SELECT "over_receipt_tolerance_bp" AS o, "price_tolerance_bp" AS b, "price_tolerance_abs" AS a
           FROM "erp_purchase_settings" WHERE "tenant_id" = $1`,
        [tenantId],
      )) as Array<{ o: unknown; b: unknown; a: unknown }>;
      const existing = rows[0];
      const overReceipt = existing ? Number(existing.o) : 0;
      const priceBp = column === 'price_tolerance_bp' ? Number(value) : existing ? Number(existing.b) : 0;
      const priceAbs = column === 'price_tolerance_abs' ? String(value) : existing ? String(existing.a) : '0';
      await manager.query(
        `INSERT INTO "erp_purchase_settings"
           ("tenant_id", "over_receipt_tolerance_bp", "price_tolerance_bp", "price_tolerance_abs", "updated_at")
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT ("tenant_id") DO UPDATE SET
           "over_receipt_tolerance_bp" = EXCLUDED."over_receipt_tolerance_bp",
           "price_tolerance_bp" = EXCLUDED."price_tolerance_bp",
           "price_tolerance_abs" = EXCLUDED."price_tolerance_abs",
           "updated_at" = now()`,
        [tenantId, overReceipt, priceBp, priceAbs],
      );
      return;
    }

    await manager.query(
      `INSERT INTO "tenant_policy_settings" ("tenant_id", "key", "value", "updated_by", "updated_at", "auto_revert_at", "reason")
       VALUES ($1, $2, $3::jsonb, $4, now(), $5, $6)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET
         "value" = EXCLUDED."value",
         "updated_by" = EXCLUDED."updated_by",
         "updated_at" = now(),
         "auto_revert_at" = EXCLUDED."auto_revert_at",
         "reason" = EXCLUDED."reason"`,
      [tenantId, definition.key, JSON.stringify(value), userId.slice(0, 64), autoRevertAt, reason],
    );
  }

  /** jsonb (or a column value) to the registry's value type. */
  private coerce(definition: PolicyDefinition, raw: unknown): PolicyValue {
    if (raw === null || raw === undefined || raw === '') return definition.default;
    if (definition.type === 'int') return Number(raw);
    if (definition.type === 'bool') return raw === true || raw === 'true';
    return String(raw);
  }

  private view(
    definition: PolicyDefinition,
    value: PolicyValue,
    stored: StoredPolicyMeta | null,
  ): PolicyView {
    const isWeakened = isPolicyWeakened(definition.key, value);
    const warning = getWeakeningWarning(definition.key, value);
    return {
      key: definition.key,
      group: definition.group,
      type: definition.type,
      allowed: definition.allowed,
      default: definition.default,
      labelFa: definition.labelFa,
      descriptionFa: definition.descriptionFa,
      value,
      isDefault: value === definition.default,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
      editable: definition.group !== 'A',
      isWeakened,
      warning,
      autoRevertAt: stored?.autoRevertAt ?? null,
      reason: stored?.reason ?? null,
    };
  }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
