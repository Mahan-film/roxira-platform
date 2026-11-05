const UNITS = [
  "صفر",
  "یک",
  "دو",
  "سه",
  "چهار",
  "پنج",
  "شش",
  "هفت",
  "هشت",
  "نه",
  "ده",
  "یازده",
  "دوازده",
  "سیزده",
  "چهارده",
  "پانزده",
  "شانزده",
  "هفده",
  "هجده",
  "نوزده",
];

const TENS = [
  "بیست",
  "سی",
  "چهل",
  "پنجاه",
  "شصت",
  "هفتاد",
  "هشتاد",
  "نود",
];

const HUNDREDS = [
  "صد",
  "دویست",
  "سیصد",
  "چهارصد",
  "پانصد",
  "ششصد",
  "هفتصد",
  "هشتصد",
  "نهصد",
];

function convertThreeDigits(num: number): string {
  if (num === 0) return "";
  if (num < 20) return UNITS[num];
  if (num < 100) {
    const tensPart = TENS[Math.floor(num / 10) - 2];
    const rem = num % 10;
    return rem > 0 ? `${tensPart} و ${UNITS[rem]}` : tensPart;
  }
  const hundredPart = HUNDREDS[Math.floor(num / 100) - 1];
  const rem = num % 100;
  if (rem === 0) return hundredPart;
  if (rem < 20) return `${hundredPart} و ${UNITS[rem]}`;
  const tensPart = TENS[Math.floor(rem / 10) - 2];
  const unitRem = rem % 10;
  const remText = unitRem > 0 ? `${tensPart} و ${UNITS[unitRem]}` : tensPart;
  return `${hundredPart} و ${remText}`;
}

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function wordsBigInt(n: bigint): string {
  if (n >= BigInt(1000000000)) {
    const q = n / BigInt(1000000000);
    const r = n % BigInt(1000000000);
    const qWords = wordsBigInt(q) + " میلیارد";
    return r > BigInt(0) ? `${qWords} و ${wordsBigInt(r)}` : qWords;
  }

  const parts: string[] = [];

  const millions = Number(n / BigInt(1000000));
  let rem = n % BigInt(1000000);

  if (millions > 0) {
    const mText = convertThreeDigits(millions);
    parts.push(`${mText} میلیون`);
  }

  const thousands = Number(rem / BigInt(1000));
  rem = rem % BigInt(1000);

  if (thousands > 0) {
    if (thousands === 1) {
      parts.push("هزار");
    } else {
      parts.push(`${convertThreeDigits(thousands)} هزار`);
    }
  }

  const units = Number(rem);
  if (units > 0) {
    parts.push(convertThreeDigits(units));
  }

  return parts.join(" و ");
}

export function integerToPersianWords(value: bigint | string): string {
  let asciiStr: string;
  if (typeof value === "bigint") {
    if (value < BigInt(0)) throw new RangeError("Value cannot be negative");
    asciiStr = value.toString();
  } else {
    asciiStr = toAsciiDigits(value);
    if (!/^\d+$/.test(asciiStr)) {
      throw new RangeError("Invalid integer string");
    }
  }

  const n = BigInt(asciiStr);
  if (n === BigInt(0)) return "صفر";
  return wordsBigInt(n);
}
