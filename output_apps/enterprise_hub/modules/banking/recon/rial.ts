import { fixPersianChars, toAsciiDigits } from '../../data_import/normaliser/normalise';

/**
 * Rial amounts of the reconciliation pipeline are `bigint` whole rials (BIGINT columns). Ledger
 * amounts (numeric(18,2)) are compared in "minor" units (rial x 100) so nothing is rounded.
 */
export const MINOR_PER_RIAL = 100n;

export type ParsedRial =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'ok'; value: bigint };

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

/** Statement text is untrusted: strip control/bidi characters, collapse whitespace, cap length. */
export function sanitizeText(value: unknown, max = 500): string {
  if (value === null || value === undefined) {
    return '';
  }
  return fixPersianChars(toAsciiDigits(String(value)))
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Whole-rial amount of a bank-export cell: `1,250,000`, `۱٬۲۵۰٬۰۰۰`, `-500`, `500-`, `(500)`,
 * `1250000.00`, `... تومان` (x 10). A non-zero fraction is invalid (rial is indivisible here).
 */
export function parseRial(raw: unknown): ParsedRial {
  if (raw === null || raw === undefined) {
    return { kind: 'empty' };
  }
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw)
      ? { kind: 'ok', value: BigInt(raw) }
      : { kind: 'invalid' };
  }
  const text = sanitizeText(raw, 64);
  if (text === '' || /^[-–—−]+$/.test(text)) {
    return { kind: 'empty' };
  }
  const negative =
    /^\(.*\)$/.test(text) || /^[-−]/.test(text) || /[-−]$/.test(text);
  const toman = /تومان/.test(text) && !/ریال/.test(text);
  const numeric = text
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/(تومان|ریال|IRR|IRT|rial|toman)/gi, '')
    .replace(/^[(\-−]+|[)\-−]+$/g, '');
  const match = /^(\d{1,18})(?:\.(\d+))?$/.exec(numeric);
  if (!match || (match[2] && /[1-9]/.test(match[2]))) {
    return { kind: 'invalid' };
  }
  const magnitude = BigInt(match[1]) * (toman ? 10n : 1n);
  return { kind: 'ok', value: negative ? -magnitude : magnitude };
}

/** Ledger numeric (number or decimal string) to minor units without float arithmetic on sums. */
export function ledgerToMinor(value: number | string | null | undefined): bigint {
  if (value === null || value === undefined) {
    return 0n;
  }
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    return 0n;
  }
  const minor =
    BigInt(match[2]) * MINOR_PER_RIAL + BigInt((match[3] ?? '').padEnd(2, '0').slice(0, 2));
  return match[1] === '-' ? -minor : minor;
}

export function rialToMinor(rial: bigint): bigint {
  return rial * MINOR_PER_RIAL;
}

/** Whole rials of a minor amount; fractions are truncated toward zero (report display only). */
export function minorToRial(minor: bigint): bigint {
  return minor / MINOR_PER_RIAL;
}

export function absBig(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** `bigint` to a JSON-safe string (BIGINT columns come back from pg as strings too). */
export function rialString(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}
