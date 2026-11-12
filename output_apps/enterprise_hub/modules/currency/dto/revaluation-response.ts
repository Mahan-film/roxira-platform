/**
 * Express `JSON.stringify` throws on bigint, so minor-unit amounts leave the controller as exact
 * decimal strings (minor units, never floats). Applied at the HTTP boundary only.
 */
export type BigIntToString<T> = T extends bigint
  ? string
  : T extends Array<infer U>
    ? Array<BigIntToString<U>>
    : T extends object
      ? { [K in keyof T]: BigIntToString<T[K]> }
      : T;

export function bigintsToStrings<T>(value: T): BigIntToString<T> {
  if (typeof value === 'bigint') return value.toString() as BigIntToString<T>;
  if (Array.isArray(value)) return value.map((v) => bigintsToStrings(v)) as BigIntToString<T>;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, bigintsToStrings(v)]),
    ) as BigIntToString<T>;
  }
  return value as BigIntToString<T>;
}
