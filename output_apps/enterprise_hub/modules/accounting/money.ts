/**
 * Exact money arithmetic for the ledger. Amounts are handled as integer minor units (BigInt) and
 * parsed from decimal strings; they are never summed or compared as floats, so balance checks are
 * exact with no tolerance.
 */
import { MONEY_SCALE } from './constants/accounting.constants';

const FACTOR = 10 ** MONEY_SCALE;
const FACTOR_BIG = BigInt(FACTOR);

/** numeric(18,2): 16 integer digits. */
const MAX_INTEGER_DIGITS = 16;
const DECIMAL_PATTERN = new RegExp(
  `^(-?)(\\d{1,${MAX_INTEGER_DIGITS}})(?:\\.(\\d{1,${MONEY_SCALE}}))?$`,
);
/** Largest JSON number whose minor units are still an exactly representable integer. */
const MAX_SAFE_NUMBER = Number.MAX_SAFE_INTEGER / FACTOR;
const MAX_NUMBER_MINOR = 2n ** 51n;

/** Exact JSON money value: a number when exact, otherwise a decimal string (see `fromMinor`). */
export type Money = number | string;

export class MoneyFormatError extends Error {}

/**
 * Minor units of a decimal string ("1234.5", "90000000000000000.01"). Strings are the exact
 * transport for amounts a JSON number cannot carry; more than `MONEY_SCALE` decimals is an error
 * (never silently rounded).
 */
export function parseMinor(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new MoneyFormatError(
      `Invalid amount "${value}": expected a decimal with at most ${MONEY_SCALE} decimals.`,
    );
  }
  const [, sign, integer, fraction = ''] = match;
  const minor =
    BigInt(integer) * FACTOR_BIG + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
  return sign === '-' ? -minor : minor;
}

/**
 * Minor units of an amount received as a JSON number or a decimal string. A number is accepted
 * only inside the range where it is exact; larger amounts must be sent as strings.
 */
export function toMinor(value: number | string): bigint {
  if (typeof value === 'string') {
    return parseMinor(value);
  }
  if (!Number.isFinite(value)) {
    throw new MoneyFormatError(`Invalid amount: ${value}`);
  }
  if (Math.abs(value) > MAX_SAFE_NUMBER) {
    throw new MoneyFormatError(
      'Amount is too large for a JSON number; send it as a decimal string.',
    );
  }
  return BigInt(Math.round(value * FACTOR));
}

export function sumMinor(values: Array<number | string>): bigint {
  return values.reduce<bigint>((sum, value) => sum + toMinor(value), 0n);
}

/** Exact decimal string ("-12.30") of minor units; what is sent to PostgreSQL numeric columns. */
export function minorToDecimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const integer = abs / FACTOR_BIG;
  const fraction = (abs % FACTOR_BIG).toString().padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

/**
 * JSON-safe amount: a number when it is exact, otherwise the exact decimal string. Keeps the API
 * shape for normal amounts and never returns a silently rounded value.
 */
export function fromMinor(minor: bigint): number | string {
  const abs = minor < 0n ? -minor : minor;
  // Above 2^51 minor units a double no longer carries every cent (toMinor(fromMinor(x)) drifts by
  // one from 2^52, proven by accounting.ledger.property.spec.ts), so those amounts go out as exact strings.
  if (abs <= MAX_NUMBER_MINOR) {
    return Number(minor) / FACTOR;
  }
  return minorToDecimal(minor);
}

/**
 * Minor units of a PostgreSQL numeric value (string, as `pg` returns it) or a legacy number.
 * Longer scales (sums of fx columns) are rounded half away from zero to `MONEY_SCALE`.
 */
export function fromDb(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  if (typeof value === 'number') {
    return toMinor(value);
  }
  const [integer, fraction = ''] = value.trim().split('.');
  const kept = parseMinor(`${integer}.${fraction.slice(0, MONEY_SCALE) || '0'}`);
  const roundUp = (fraction[MONEY_SCALE] ?? '0') >= '5';
  if (!roundUp) {
    return kept;
  }
  return integer.startsWith('-') ? kept - 1n : kept + 1n;
}

/**
 * Exact scaled integer of a non-negative decimal (number or string) with at most `scale` decimals
 * (used for amount_fx / fx_rate, scale 6).
 */
export function parseScaled(value: number | string, scale: number): bigint {
  const text =
    typeof value === 'number'
      ? value.toString().includes('e')
        ? value.toFixed(scale)
        : value.toString()
      : value.trim();
  const match = /^(\d{1,18})(?:\.(\d{1,}))?$/.exec(text);
  if (!match || (match[2] ?? '').length > scale) {
    throw new MoneyFormatError(
      `Invalid decimal "${value}": at most ${scale} decimals.`,
    );
  }
  return BigInt(match[1] + (match[2] ?? '').padEnd(scale, '0'));
}

/** Decimal string with exactly `scale` decimals of a scaled integer. */
export function scaledToDecimal(scaled: bigint, scale: number): string {
  const text = scaled.toString().padStart(scale + 1, '0');
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}
