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

/**
 * Fields that represent sensitive purchase pricing specifically within purchasing and vendor supplier contexts.
 * On customer-facing sales/invoicing routes, unitPrice is a selling price and is not masked;
 * on purchasing routes, unitPrice, orderUnitPrice, and priceDifference are purchase costs and must be masked (T76).
 */
export const PURCHASING_COST_FIELD_REGEX =
  /^(unit_?price|order_?unit_?price|price_?difference|unit_?cost|buy_?price|purchase_?price)$/i;

/**
 * Monetary value keys that carry cost-derived money on inventory valuation / report routes
 * (cardex openingValue/closingValue/runningValue, stock-balance `value`, FIFO values, landed-cost `amount`,
 * `*Minor` money fields). Applied ONLY on valuation routes (see isValuationPath), so selling-side
 * `amount` / `totalAmount` on sales and invoicing routes are untouched.
 */
export const VALUATION_VALUE_FIELD_REGEX =
  /^(?!.*cost_?cent[er]).*(value|valuation|amount|worth|fifo|weighted|average|running_?val|minor$)/i;

/**
 * Every monetary field of a purchase document (supplier invoice subtotal/total/vat, order and receipt
 * totals, line values, landed-cost shares, tolerances). Applied ONLY on purchasing routes; identifier-like
 * keys (ending in Id/Code/Number/Ref) are excluded by isCostField.
 */
export const PURCHASING_MONEY_FIELD_REGEX =
  /^(?:.*(?:total|vat|tax|discount|share|gross|balance|amount|value|price|tolerance_?abs)|net.*|to_?(?:inventory|cogs))/i;

/**
 * Detects routes whose responses are cost-derived money: everything under inventory (reports, cardex,
 * stock-balance, valuation, documents, openings, landed cost, purchasing), manufacturing / production /
 * COGS / landed-cost / valuation routes elsewhere, and the gross-profit / profitability reports.
 */
export function isValuationPath(pathname: string): boolean {
  if (!pathname) return false;
  const clean = pathname.split('?')[0].split('#')[0].replace(/^\/v\d+/, '');
  return /\/(inventory|manufactur[a-z]*|production|cogs|landed-?cost|valuation|stock-valuation|gross-profit|profitability)(\/|$)/i.test(
    clean,
  );
}

/**
 * Detects whether a request pathname targets purchasing, supplier invoices, or procurement workflows.
 */
export function isPurchasingPath(pathname: string): boolean {
  if (!pathname) return false;
  const clean = pathname.split('?')[0].split('#')[0].replace(/^\/v\d+/, '');
  return /\/(purchas|supplier-invoice|vendor)/i.test(clean);
}

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
   * When isPurchasingRoute is true, also matches purchase-specific fields like unitPrice, orderUnitPrice, and priceDifference.
   */
  isCostField(key: string, isPurchasingRoute = false, isValuationRoute = false): boolean {
    if (/^(cost_?cent(er|re)(_?(id|code|name|title))?)$/i.test(key)) {
      return false;
    }
    if (COST_SENSITIVE_FIELD_REGEX.test(key)) {
      return true;
    }
    if (isPurchasingRoute && PURCHASING_COST_FIELD_REGEX.test(key)) {
      return true;
    }
    if (
      isPurchasingRoute &&
      PURCHASING_MONEY_FIELD_REGEX.test(key) &&
      !/(Id|_id|Code|_code|Number|_number|Ref|_ref)$/.test(key)
    ) {
      return true;
    }
    if (isValuationRoute && VALUATION_VALUE_FIELD_REGEX.test(key)) {
      return true;
    }
    return false;
  }

  /**
   * Recursively scrubs sensitive purchase cost and price fields from API response payloads.
   * If canViewCost is false, sensitive fields are set to null.
   * Memoises cloned instances via Map to safely handle shared references and bidirectional cycles,
   * scans nested arrays, Sets, and Maps, and preserves Date, Buffer, BigInt, Streams,
   * ArrayBuffer, and TypedArrays without corruption.
   */
  maskCostFields<T>(
    payload: T,
    canViewCost: boolean,
    visited = new Map<object, any>(),
    isPurchasingRoute = false,
    isValuationRoute = false,
  ): T {
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
        sanitizedArr.push(this.maskCostFields(item, canViewCost, visited, isPurchasingRoute, isValuationRoute));
      }
      return sanitizedArr as unknown as T;
    }

    // Sets: scan elements and return cloned set
    if (payload instanceof Set) {
      const sanitizedSet = new Set();
      visited.set(payload, sanitizedSet);
      for (const item of payload) {
        sanitizedSet.add(this.maskCostFields(item, canViewCost, visited, isPurchasingRoute, isValuationRoute));
      }
      return sanitizedSet as unknown as T;
    }

    // Maps: scan keys and values recursively
    if (payload instanceof Map) {
      const sanitizedMap = new Map();
      visited.set(payload, sanitizedMap);
      for (const [k, v] of payload.entries()) {
        const isKeyCost = typeof k === 'string' && this.isCostField(k, isPurchasingRoute, isValuationRoute);
        sanitizedMap.set(
          k,
          isKeyCost ? null : this.maskCostFields(v, canViewCost, visited, isPurchasingRoute, isValuationRoute),
        );
      }
      return sanitizedMap as unknown as T;
    }

    // Objects and Class/Entity instances: clone with prototype preserved
    const proto = Object.getPrototypeOf(payload);
    const sanitized: Record<string, any> =
      proto && proto !== Object.prototype ? Object.create(proto) : {};
    visited.set(payload, sanitized);
    for (const [key, value] of Object.entries(payload)) {
      if (this.isCostField(key, isPurchasingRoute, isValuationRoute)) {
        sanitized[key] = null;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.maskCostFields(value, canViewCost, visited, isPurchasingRoute, isValuationRoute);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized as T;
  }
}
