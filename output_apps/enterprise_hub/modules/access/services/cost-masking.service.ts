import { Injectable } from '@nestjs/common';
import { AccessContext } from '../access-context';
import { SystemRole, systemRoleFieldVisibility } from '../catalogue';
import { effectiveFieldVisibility } from '../policy-evaluator';

export const COST_SENSITIVE_FIELD_NAMES: ReadonlySet<string> = new Set([
  'unitPurchaseCost',
  'unit_purchase_cost',
  'unitCost',
  'unit_cost',
  'purchasePrice',
  'purchase_price',
  'landedCost',
  'landed_cost',
  'totalCost',
  'total_cost',
  'cogs',
  'valuation',
  'unitPrice',
  'unit_price',
  'lineCost',
  'line_cost',
  'purchaseCost',
  'purchase_cost',
  'averageCost',
  'average_cost',
  'cost',
  'buyPrice',
  'buy_price',
]);

@Injectable()
export class CostMaskingService {
  /**
   * Determines whether the given role or access context is allowed to view cost and purchase prices.
   * Uses field visibility from catalogue/policy-evaluator (fail-closed, Lesson 25).
   */
  canViewCost(roleOrCtx: SystemRole | string | AccessContext | null | undefined): boolean {
    if (!roleOrCtx) {
      return false;
    }

    // If an AccessContext is provided, evaluate effectiveFieldVisibility (includes custom roles & overrides)
    if (typeof roleOrCtx === 'object' && 'roleKey' in roleOrCtx) {
      const vis = effectiveFieldVisibility(roleOrCtx as AccessContext);
      return vis?.cost === true;
    }

    // If a role key string is provided, check systemRoleFieldVisibility
    if (typeof roleOrCtx === 'string') {
      const vis = systemRoleFieldVisibility(roleOrCtx);
      return vis?.cost === true;
    }

    return false;
  }

  /**
   * Recursively scrubs sensitive purchase cost and price fields from API response payloads.
   * If canViewCost is false, sensitive fields are set to null.
   * Preserves Date, Buffer, BigInt, and primitive values without corruption.
   */
  maskCostFields<T>(payload: T, canViewCost: boolean): T {
    if (canViewCost || payload === null || payload === undefined) {
      return payload;
    }

    // Primitive values
    if (typeof payload !== 'object') {
      return payload;
    }

    // Preserve Date and Buffer instances without converting to {}
    if (
      payload instanceof Date ||
      (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload))
    ) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.maskCostFields(item, canViewCost)) as unknown as T;
    }

    // Plain object
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (COST_SENSITIVE_FIELD_NAMES.has(key)) {
        sanitized[key] = null;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.maskCostFields(value, canViewCost);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized as T;
  }
}
