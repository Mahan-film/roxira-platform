import { Injectable } from '@nestjs/common';
import { AccessContext } from '../access-context';
import { SystemRole, systemRoleFieldVisibility } from '../catalogue';
import { effectiveFieldVisibility } from '../policy-evaluator';

/**
 * Regex matching any field name related to unit/total purchase costs, cogs, valuation, or gross profit,
 * while safely ignoring dimension keys such as costCenter / costCentre.
 */
export const COST_SENSITIVE_FIELD_REGEX =
  /^(?!.*cost_?cent[er]).*(cost|purchase.?price|buy.?price|cogs|valuation|gross.?profit)/i;

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
   * Checks if a field name represents a sensitive purchase cost or valuation.
   */
  isCostField(key: string): boolean {
    return COST_SENSITIVE_FIELD_REGEX.test(key);
  }

  /**
   * Recursively scrubs sensitive purchase cost and price fields from API response payloads.
   * If canViewCost is false, sensitive fields are set to null.
   * Cycle-safe with WeakSet, scans nested arrays, Sets, and Maps, and preserves
   * Date, Buffer, BigInt, Streams, and TypedArrays without corruption.
   */
  maskCostFields<T>(payload: T, canViewCost: boolean, visited = new WeakSet<object>()): T {
    if (canViewCost || payload === null || payload === undefined) {
      return payload;
    }

    // Primitive values (string, number, bigint, boolean, symbol)
    if (typeof payload !== 'object') {
      return payload;
    }

    // Cycle guard for bidirectional or recursive object graphs
    if (visited.has(payload)) {
      return payload;
    }
    visited.add(payload);

    // Arrays: scan all elements recursively
    if (Array.isArray(payload)) {
      return payload.map((item) => this.maskCostFields(item, canViewCost, visited)) as unknown as T;
    }

    // Sets: scan elements and return cloned set
    if (payload instanceof Set) {
      const sanitizedSet = new Set();
      for (const item of payload) {
        sanitizedSet.add(this.maskCostFields(item, canViewCost, visited));
      }
      return sanitizedSet as unknown as T;
    }

    // Maps: scan keys and values recursively
    if (payload instanceof Map) {
      const sanitizedMap = new Map();
      for (const [k, v] of payload.entries()) {
        const isKeyCost = typeof k === 'string' && this.isCostField(k);
        sanitizedMap.set(k, isKeyCost ? null : this.maskCostFields(v, canViewCost, visited));
      }
      return sanitizedMap as unknown as T;
    }

    // Preserve special non-plain objects: Date, Buffer, TypedArray, Streams
    if (
      payload instanceof Date ||
      (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) ||
      payload instanceof Uint8Array ||
      typeof (payload as any).pipe === 'function'
    ) {
      return payload;
    }

    // Objects and Class/Entity instances: clone with prototype preserved
    const proto = Object.getPrototypeOf(payload);
    const sanitized: Record<string, any> =
      proto && proto !== Object.prototype ? Object.create(proto) : {};
    for (const [key, value] of Object.entries(payload)) {
      if (this.isCostField(key)) {
        sanitized[key] = null;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.maskCostFields(value, canViewCost, visited);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized as T;
  }
}
