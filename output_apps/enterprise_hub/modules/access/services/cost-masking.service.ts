import { Injectable } from '@nestjs/common';
import { SystemRole } from '../catalogue';

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
]);

@Injectable()
export class CostMaskingService {
  /**
   * Determines whether the given role is allowed to view cost and purchase prices.
   * Sales roles and cheque reviewers are strictly forbidden from viewing cost data.
   */
  canViewCost(roleKey: SystemRole | string): boolean {
    if (roleKey === SystemRole.SALES || roleKey === SystemRole.CHEQUE_REVIEWER) {
      return false;
    }
    // Fail closed if unknown role
    if (!roleKey) {
      return false;
    }
    return true;
  }

  /**
   * Recursively scrubs sensitive purchase cost and price fields from API response payloads.
   * If canViewCost is false, sensitive fields are stripped or set to null.
   */
  maskCostFields<T>(payload: T, canViewCost: boolean): T {
    if (canViewCost || payload === null || payload === undefined) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.maskCostFields(item, canViewCost)) as unknown as T;
    }

    if (typeof payload === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (COST_SENSITIVE_FIELD_NAMES.has(key)) {
          // Sensitive cost field hidden from sales roles in API response
          sanitized[key] = null;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.maskCostFields(value, canViewCost);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized as T;
    }

    return payload;
  }
}
