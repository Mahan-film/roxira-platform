/**
 * Offline format checks for the Sayad cheque fields. Nothing here calls the central bank.
 *
 * Source status (docs/legal_sources/iran/ has no cheque or Sayad text):
 *  - Sayad id, 16 digits: the length comes from public explainers (docs/accounting/CHEQUES.md §1).
 *    No public check-digit rule exists, so only length and digits are checked. `unclear`.
 *  - National code (10 digits, real person): the public mod-11 checksum. `unclear` as a legal rule,
 *    it is a format check only.
 *  - Legal-entity national id (11 digits): the public weighted checksum. `unclear`, same reason.
 *  - Registration status is whatever the user declares; the system never reads it from Sayad.
 */

export enum SayadRegistrationStatus {
  /** Nothing declared yet. */
  UNKNOWN = 'unknown',
  /** The user declares the cheque is registered in Sayad. */
  REGISTERED = 'registered',
  /** The user declares it is not registered (paper cheque outside Sayad). */
  UNREGISTERED = 'unregistered',
}

export const SAYAD_FORMAT_STATUS = 'unclear' as const;

/** Persian and Arabic-Indic digits to Latin, trimmed. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

/** 16 digits and not one repeated digit (a typo or placeholder such as 0000000000000000). */
export function isValidSayadNumber(value: string): boolean {
  return /^[0-9]{16}$/.test(value) && !/^(\d)\1{15}$/.test(value);
}

/** Iranian national code of a natural person: 10 digits, mod-11 check digit. */
export function isValidNationalCode(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const sum = digits.slice(0, 9).reduce((s, d, i) => s + d * (10 - i), 0);
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return check === digits[9];
}

const LEGAL_WEIGHTS = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];

/** National id of a legal person: 11 digits, weighted checksum. */
export function isValidLegalNationalId(value: string): boolean {
  if (!/^[0-9]{11}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const offset = digits[9] + 2;
  const sum = LEGAL_WEIGHTS.reduce((s, w, i) => s + (digits[i] + offset) * w, 0);
  const remainder = sum % 11;
  return (remainder === 10 ? 0 : remainder) === digits[10];
}

/** The receiver can be a person (10 digits) or a company (11 digits). */
export function isValidReceiverNationalId(value: string): boolean {
  return value.length === 11 ? isValidLegalNationalId(value) : isValidNationalCode(value);
}
