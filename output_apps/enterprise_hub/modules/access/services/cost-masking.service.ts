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
   * Explicitly avoids masking cost centre dimension keys (e.g. costCenter, costCentre, costCenterId).
   */
  isCostField(key: string): boolean {
    if (/^(cost_?cent(er|re)(_?(id|code|name|title))?)$/i.test(key)) {
      return false;
    }
    return COST_SENSITIVE_FIELD_REGEX.test(key);
  }

  /**
   * Recursively scrubs sensitive purchase cost and price fields from API response payloads.
   * If canViewCost is false, sensitive fields are set to null.
   * Memoises cloned instances via Map to safely handle shared references and bidirectional cycles,
   * scans nested arrays, Sets, and Maps, and preserves Date, Buffer, BigInt, Streams,
   * ArrayBuffer, and TypedArrays without corruption.
   */
  maskCostFields<T>(payload: T, canViewCost: boolean, visited = new Map<object, any>()): T {
    if (canViewCost || payload === null || payload === undefined) {
      return payload;
    }

    // Primitive values (string, number, bigint, boolean, symbol)
    if (typeof payload !== 'object') {
      return payload;
    }

    // Cycle & shared reference guard: return memoised masked clone
    if (visited.has(payload)) {
      return visited.get(payload);
    }

    // Preserve special non-plain objects: Date, Buffer, TypedArray, ArrayBuffer, Streams
    if (
      payload instanceof Date ||
      (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) ||
      ArrayBuffer.isView(payload) ||
      payload instanceof ArrayBuffer ||
      typeof (payload as any).pipe === 'function'
    ) {
      return payload;
    }

    // Arrays: scan all elements recursively
    if (Array.isArray(payload)) {
      const sanitizedArr: any[] = [];
      visited.set(payload, sanitizedArr);
      for (const item of payload) {
        sanitizedArr.push(this.maskCostFields(item, canViewCost, visited));
      }
      return sanitizedArr as unknown as T;
    }

    // Sets: scan elements and return cloned set
    if (payload instanceof Set) {
      const sanitizedSet = new Set();
      visited.set(payload, sanitizedSet);
      for (const item of payload) {
        sanitizedSet.add(this.maskCostFields(item, canViewCost, visited));
      }
      return sanitizedSet as unknown as T;
    }

    // Maps: scan keys and values recursively
    if (payload instanceof Map) {
      const sanitizedMap = new Map();
      visited.set(payload, sanitizedMap);
      for (const [k, v] of payload.entries()) {
        const isKeyCost = typeof k === 'string' && this.isCostField(k);
        sanitizedMap.set(k, isKeyCost ? null : this.maskCostFields(v, canViewCost, visited));
      }
      return sanitizedMap as unknown as T;
    }

    // Objects and Class/Entity instances: clone with prototype preserved
    const proto = Object.getPrototypeOf(payload);
    const sanitized: Record<string, any> =
      proto && proto !== Object.prototype ? Object.create(proto) : {};
    visited.set(payload, sanitized);
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
