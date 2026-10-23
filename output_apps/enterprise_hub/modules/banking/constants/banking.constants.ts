/** Default auto-match date window: a bank line and a book line may differ by this many days. */
export const DEFAULT_MATCH_WINDOW_DAYS = 3;

/** Largest window a caller may ask for. */
export const MAX_MATCH_WINDOW_DAYS = 31;

/** Amount tolerance in rial when matching (rounding in exports). */
export const MATCH_AMOUNT_TOLERANCE = 1;

/** References shorter than this are too generic to count as a reference match. */
export const MIN_REFERENCE_LENGTH = 4;

/** Postgres unique-violation SQLSTATE. */
export const PG_UNIQUE_VIOLATION = '23505';
