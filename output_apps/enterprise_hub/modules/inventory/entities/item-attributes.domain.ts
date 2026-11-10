/**
 * Domain rules and helper functions for dual units, serials, and attributes (#230 / T73).
 *
 * Requirements:
 * - Item secondary unit with a conversion ratio (carton <-> piece)
 * - Serial/batch numbers on receipt and issue
 * - Up to 10 attributes (size, colour...)
 * - Quantities stay integer minor units / strict scale bounds.
 */

export const MAX_ITEM_ATTRIBUTES = 10;

export interface DualUnitConversion {
  primaryQuantity: number;
  secondaryQuantity: number;
  unitRatio: number;
}

/**
 * Validates that attributes do not exceed the maximum allowed count (10)
 * and contain valid string keys and values.
 */
export function validateItemAttributes(
  attributes?: Record<string, string> | null,
): Record<string, string> | null {
  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }

  const keys = Object.keys(attributes);
  if (keys.length > MAX_ITEM_ATTRIBUTES) {
    throw new Error(
      `Maximum ${MAX_ITEM_ATTRIBUTES} attributes allowed per item, received ${keys.length}`,
    );
  }

  const sanitized: Record<string, string> = {};
  for (const [key, val] of Object.entries(attributes)) {
    const trimmedKey = String(key).trim();
    if (!trimmedKey) {
      throw new Error('Attribute key cannot be empty');
    }
    if (trimmedKey.length > 64) {
      throw new Error(`Attribute key '${trimmedKey}' exceeds maximum length of 64 characters`);
    }
    const trimmedVal = String(val ?? '').trim();
    if (trimmedVal.length > 255) {
      throw new Error(`Attribute value for '${trimmedKey}' exceeds maximum length of 255 characters`);
    }
    sanitized[trimmedKey] = trimmedVal;
  }

  return sanitized;
}

/**
 * Converts secondary unit quantity (e.g. cartons) to primary unit quantity (e.g. pieces)
 * based on the conversion ratio (e.g. 1 carton = 12 pieces => ratio = 12).
 * Result is rounded to 2 decimal places to maintain integer minor unit integrity.
 */
export function convertSecondaryToPrimary(
  secondaryQuantity: number,
  unitRatio: number,
): number {
  if (!Number.isFinite(secondaryQuantity) || secondaryQuantity < 0) {
    throw new Error('Secondary quantity must be a non-negative finite number');
  }
  if (!Number.isFinite(unitRatio) || unitRatio <= 0) {
    throw new Error('Unit conversion ratio must be a positive number');
  }

  // Exact arithmetic with 2 decimal places rounding
  const raw = secondaryQuantity * unitRatio;
  return Math.round(raw * 100) / 100;
}

/**
 * Converts primary unit quantity to secondary unit quantity.
 */
export function convertPrimaryToSecondary(
  primaryQuantity: number,
  unitRatio: number,
): number {
  if (!Number.isFinite(primaryQuantity) || primaryQuantity < 0) {
    throw new Error('Primary quantity must be a non-negative finite number');
  }
  if (!Number.isFinite(unitRatio) || unitRatio <= 0) {
    throw new Error('Unit conversion ratio must be a positive number');
  }

  const raw = primaryQuantity / unitRatio;
  return Math.round(raw * 100) / 100;
}

/**
 * Validates serial numbers for serialized items on receipt and issue:
 * - Each serial must be non-empty.
 * - No duplicate serial numbers in a single document/movement.
 * - If serialized, count of serial numbers must match the integer quantity.
 */
export function validateSerialNumbers(
  serials: string[] | null | undefined,
  quantity: number,
  requireMatch: boolean = false,
): string[] | null {
  if (!serials || serials.length === 0) {
    if (requireMatch && quantity > 0) {
      throw new Error(`Serial numbers required: expected ${quantity} serials, received none`);
    }
    return null;
  }

  const cleanedSerials = serials.map((s) => String(s).trim()).filter(Boolean);
  const uniqueSerials = new Set(cleanedSerials);

  if (uniqueSerials.size !== cleanedSerials.length) {
    throw new Error('Duplicate serial numbers detected in movement line');
  }

  if (requireMatch) {
    const intQty = Math.round(quantity);
    if (cleanedSerials.length !== intQty) {
      throw new Error(
        `Serial count mismatch: expected ${intQty} serial numbers, received ${cleanedSerials.length}`,
      );
    }
  }

  return cleanedSerials;
}
