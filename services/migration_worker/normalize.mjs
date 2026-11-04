/**
 * Text and date normalisation for data coming out of Iranian accounting databases.
 * The SQL fragments and the JS functions implement the same mapping; `transform.test.mjs` checks parity.
 */
const AR_TO_FA = { 'ي': 'ی', 'ك': 'ک', 'ى': 'ی', 'ۀ': 'ه', 'ؤ': 'و', 'إ': 'ا', 'أ': 'ا' };
const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** Arabic ي ك ى -> Persian ی ک ی; tatweel and soft hyphen removed; NBSP and runs of spaces -> one space; trimmed. ZWNJ is kept. */
export function normalizeText(value) {
  if (value === null || value === undefined) return null;
  let s = String(value);
  s = s.replace(/[يكىۀؤإأ]/g, (c) => AR_TO_FA[c]);
  s = s.replace(/[ـ­]/g, '').replace(/[   ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export const toAsciiDigits = (s) => s.replace(/[٠-٩۰-۹]/g, (c) => DIGITS[c]);

/** DuckDB expression equivalent to normalizeText for column expression `col` (a quoted identifier). */
export function sqlNormText(col) {
  return `nullif(trim(regexp_replace(replace(replace(replace(translate(${col}, 'يكىۀؤإأ', 'یکیهواا'), chr(1600), ''), chr(173), ''), chr(160), ' '), '\\s+', ' ', 'g')), '')`;
}

/** DuckDB expression: money-like text -> DECIMAL(28,4). Handles Persian digits, ٬ ، , separators, (1,000) and trailing minus. */
export function sqlMoney(col) {
  const ascii = `translate(${col}, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٬،٫', '01234567890123456789,,.')`;
  const clean = `replace(replace(replace(${ascii}, ',', ''), ' ', ''), chr(160), '')`;
  const body = `regexp_replace(regexp_replace(${clean}, '^\\((.*)\\)$', '-\\1'), '^(.*)-$', '-\\1')`;
  return `TRY_CAST(nullif(${body}, '') AS DECIMAL(28,4))`;
}

export const sqlAsciiDigits = (col) => `translate(${col}, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')`;

// ---- Jalali -> Gregorian (arithmetic algorithm, valid for the years 1..3000) ----
function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const months = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > months[gm]) {
    gd -= months[gm];
    gm += 1;
  }
  return [gy, gm, gd];
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Accounting exports mix Jalali (`1403/05/12`, `۱۴۰۳-۰۵-۱۲`, `14030512`) and Gregorian (`2024-08-02`, with or without time).
 * Returns an ISO date `YYYY-MM-DD` or null. Years 1200-1499 are read as Jalali, 1900-2100 as Gregorian.
 */
export function toIsoDate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = toAsciiDigits(String(raw)).trim();
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y >= 1200 && y <= 1499) {
    if (mo > 6 && d > 30) return null;
    if (mo === 12 && d > 30) return null;
    const [gy, gm, gd] = jalaliToGregorian(y, mo, d);
    if (mo === 12 && d === 30) {
      // Esfand 30 exists only in leap years: the next day must then be Farvardin 1.
      const [ny, nm, nd] = jalaliToGregorian(y + 1, 1, 1);
      if (Date.UTC(ny, nm - 1, nd) - Date.UTC(gy, gm - 1, gd) !== 86400000) return null;
    }
    return `${pad(gy, 4)}-${pad(gm)}-${pad(gd)}`;
  }
  if (y >= 1900 && y <= 2100) {
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${pad(y, 4)}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}
