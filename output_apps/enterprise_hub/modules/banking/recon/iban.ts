import { toAsciiDigits } from '../../data_import/normaliser/normalise';

/** `IR` + 24 digits, spaces/dashes removed, Persian digits converted. Null when the shape is wrong. */
export function normaliseIban(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = toAsciiDigits(value).replace(/[\s\-_.]/g, '').toUpperCase();
  return /^IR\d{24}$/.test(compact) ? compact : null;
}

/** ISO 13616 mod-97 check. */
export function isValidIban(iban: string): boolean {
  if (!/^IR\d{24}$/.test(iban)) {
    return false;
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Digits only, leading zeros dropped: `0102-33.4455` and `1023344 55` compare equal. */
export function normaliseAccountNumber(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return toAsciiDigits(value).replace(/\D/g, '').replace(/^0+/, '');
}

/** Builds a valid test/fixture IBAN for a bank id and a 19-digit body (used by fixtures only). */
export function buildIban(bankId: string, body19: string): string {
  const bban = `${bankId}${body19.padStart(19, '0').slice(-19)}`;
  const rearranged = `${bban}182700`; // IR -> 18 27, check digits placeholder 00
  let remainder = 0;
  for (const digit of rearranged) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  const check = String(98 - remainder).padStart(2, '0');
  return `IR${check}${bban}`;
}
