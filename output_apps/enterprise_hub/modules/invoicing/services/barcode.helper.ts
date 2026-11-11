/**
 * Pure SVG 1D Barcode Generator for Code128 and EAN-13.
 * Produces standard-compliant vector SVG barcodes readable by physical scanners.
 */

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const EAN_A = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const EAN_B = ['1123', '1222', '2212', '1141', '2311', '1321', '4111', '2131', '3121', '2113'];
const EAN_PARITY = [
  'AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB',
  'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA',
];

export function isEan13(value: string): boolean {
  return /^\d{13}$/.test(value.trim());
}

export function encodeCode128Svg(text: string, height = 24): string {
  const clean = text.trim() || 'EMPTY';
  const codes = [104]; // Start B
  let checksum = 104;

  for (let i = 0; i < clean.length; i++) {
    const ascii = clean.charCodeAt(i);
    const code = ascii >= 32 && ascii <= 126 ? ascii - 32 : 0;
    codes.push(code);
    checksum += (i + 1) * code;
  }

  codes.push(checksum % 103);
  codes.push(106); // Stop

  const pattern = codes.map((c) => CODE128_PATTERNS[c] ?? CODE128_PATTERNS[0]).join('');
  let x = 10; // 10 modules quiet zone
  const rects: string[] = [];
  let isBar = true;

  for (const digit of pattern) {
    const width = Number(digit);
    if (isBar) {
      rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>`);
    }
    x += width;
    isBar = !isBar;
  }

  const totalWidth = x + 10;
  return `<svg class="barcode-svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none">\n${rects.join('\n')}\n</svg>`;
}

export function encodeEan13Svg(digitsStr: string, height = 24): string {
  const digits = digitsStr.trim().split('').map(Number);
  const first = digits[0];
  const parity = EAN_PARITY[first] ?? 'AAAAAA';

  let x = 7; // 7 modules quiet zone
  const rects: string[] = [];

  // Start guard: 101 (bar 1, space 1, bar 1)
  rects.push(`<rect x="${x}" y="0" width="1" height="${height}" fill="#000"/>`);
  rects.push(`<rect x="${x + 2}" y="0" width="1" height="${height}" fill="#000"/>`);
  x += 3;

  // Left 6 digits
  for (let i = 1; i <= 6; i++) {
    const d = digits[i];
    const isA = parity[i - 1] === 'A';
    const pattern = isA ? EAN_A[d] : EAN_B[d];
    const [s1, b1, s2, b2] = pattern.split('').map(Number);
    x += s1;
    rects.push(`<rect x="${x}" y="0" width="${b1}" height="${height}" fill="#000"/>`);
    x += b1 + s2;
    rects.push(`<rect x="${x}" y="0" width="${b2}" height="${height}" fill="#000"/>`);
    x += b2;
  }

  // Center guard: 01010 (space 1, bar 1, space 1, bar 1, space 1)
  x += 1;
  rects.push(`<rect x="${x}" y="0" width="1" height="${height}" fill="#000"/>`);
  rects.push(`<rect x="${x + 2}" y="0" width="1" height="${height}" fill="#000"/>`);
  x += 4;

  // Right 6 digits (C parity: bar, space, bar, space - widths same as A)
  for (let i = 7; i <= 12; i++) {
    const d = digits[i];
    const pattern = EAN_A[d];
    const [b1, s1, b2, s2] = pattern.split('').map(Number);
    rects.push(`<rect x="${x}" y="0" width="${b1}" height="${height}" fill="#000"/>`);
    x += b1 + s1;
    rects.push(`<rect x="${x}" y="0" width="${b2}" height="${height}" fill="#000"/>`);
    x += b2 + s2;
  }

  // End guard: 101 (bar 1, space 1, bar 1)
  rects.push(`<rect x="${x}" y="0" width="1" height="${height}" fill="#000"/>`);
  rects.push(`<rect x="${x + 2}" y="0" width="1" height="${height}" fill="#000"/>`);
  x += 3 + 7; // end guard + quiet zone

  return `<svg class="barcode-svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none">\n${rects.join('\n')}\n</svg>`;
}

/**
 * Encodes value to vector SVG barcode. If the value is a 13-digit number,
 * formats as EAN-13; otherwise encodes as Code128.
 */
export function generateBarcodeSvg(value: string, height = 24): { svg: string; symbology: 'EAN-13' | 'Code128' } {
  const clean = value.trim();
  if (isEan13(clean)) {
    return {
      svg: encodeEan13Svg(clean, height),
      symbology: 'EAN-13',
    };
  }
  return {
    svg: encodeCode128Svg(clean, height),
    symbology: 'Code128',
  };
}
