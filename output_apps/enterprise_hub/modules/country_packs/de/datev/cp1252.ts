/**
 * Windows-1252 (CP1252) and UTF-8 with BOM encoders for DATEV EXTF 700 files.
 */

export type DatevEncoding = 'cp1252' | 'utf8-bom';

const CP1252_HIGH_MAP: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/** Encodes a string into a Windows-1252 (CP1252) Buffer. Unmappable characters become '?'. */
export function encodeCp1252(text: string): Buffer {
  const bytes = Buffer.allocUnsafe(text.length);
  let out = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // Handle surrogate pairs cleanly as single replacement '?'
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes[out++] = 0x3f;
      i += 1;
      continue;
    }
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes[out++] = code;
    } else {
      bytes[out++] = CP1252_HIGH_MAP[code] ?? 0x3f;
    }
  }
  return bytes.subarray(0, out);
}

/** Encodes a string as UTF-8 with BOM (EF BB BF) or CP1252. */
export function encodeDatevBuffer(text: string, encoding: DatevEncoding): Buffer {
  if (encoding === 'utf8-bom') {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    return Buffer.concat([bom, Buffer.from(text, 'utf8')]);
  }
  return encodeCp1252(text);
}
