/**
 * رمزگشایی متن بر پایهٔ محتوا (نه پسوند): BOM، UTF-8 معتبر، UTF-16، Windows-1256.
 *
 * Iran System عمداً رمزگشایی نمی‌شود: جدول تأییدشده‌ای در دسترس نیست و یک جدول اشتباه
 * نام‌های فارسی را بی‌صدا خراب می‌کند. این رمزگذاری (و هر رمزگذاری ناشناختهٔ ۸‌بیتی که
 * نتیجه‌اش حروف عربی/فارسی نیست) با راهنمای فارسی رد می‌شود.
 */

import { ReaderError } from '../reader.types';

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1256' | 'ascii';
  notes: string[];
}

export const IRAN_SYSTEM_MESSAGE =
  'رمزگذاری این فایل شناخته نشد (احتمالاً Iran System یا کدپیج قدیمی). ' +
  'از نرم‌افزار قبلی خود خروجی را با رمزگذاری «یونیکد/UTF-8» یا «ویندوز-۱۲۵۶» بگیرید، ' +
  'یا فایل را در اکسل باز کنید و به‌صورت XLSX ذخیره کنید و دوباره بفرستید.';

function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function looksUtf16(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length < 4) {
    return null;
  }
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < sample.length - 1; i += 2) {
    if (sample[i] === 0) {
      evenZero += 1;
    }
    if (sample[i + 1] === 0) {
      oddZero += 1;
    }
  }
  const pairs = Math.floor(sample.length / 2);
  if (oddZero > pairs * 0.3 && evenZero < pairs * 0.05) {
    return 'utf-16le';
  }
  if (evenZero > pairs * 0.3 && oddZero < pairs * 0.05) {
    return 'utf-16be';
  }
  return null;
}

/** سهم نویسه‌های عربی/فارسی در میان بایت‌های بالای ۰x۸۰ پس از رمزگشایی با cp1256. */
export function arabicShareOfHighBytes(buffer: Buffer): { high: number; share: number } {
  let high = 0;
  let arabic = 0;
  const limit = Math.min(buffer.length, 65_536);
  const decoder = new TextDecoder('windows-1256');
  for (let i = 0; i < limit; i += 1) {
    const byte = buffer[i];
    if (byte >= 0x80) {
      high += 1;
      const ch = decoder.decode(buffer.subarray(i, i + 1));
      if (/[؀-ۿ‌‏]/.test(ch)) {
        arabic += 1;
      }
    }
  }
  return { high, share: high === 0 ? 1 : arabic / high };
}

/** تشخیص رمزگذاری و برگرداندن متن. هرگز نویسهٔ خراب را بی‌صدا نمی‌پذیرد. */
export function decodeText(buffer: Buffer): DecodedText {
  const notes: string[] = [];
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8-bom', notes };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le', notes };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be', notes };
  }
  const utf16 = looksUtf16(buffer);
  if (utf16 === 'utf-16le') {
    return { text: buffer.toString('utf16le'), encoding: 'utf-16le', notes };
  }
  if (utf16 === 'utf-16be') {
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be', notes };
  }
  let hasHigh = false;
  for (let i = 0; i < buffer.length && !hasHigh; i += 1) {
    hasHigh = buffer[i] >= 0x80;
  }
  if (!hasHigh) {
    return { text: buffer.toString('latin1'), encoding: 'ascii', notes };
  }
  if (isValidUtf8(buffer)) {
    return { text: buffer.toString('utf8'), encoding: 'utf-8', notes };
  }
  const { high, share } = arabicShareOfHighBytes(buffer);
  if (high >= 12 && share < 0.6) {
    throw new ReaderError(IRAN_SYSTEM_MESSAGE);
  }
  notes.push('رمزگذاری فایل Windows-1256 تشخیص داده شد و به یونیکد تبدیل شد.');
  return {
    text: new TextDecoder('windows-1256').decode(buffer),
    encoding: 'windows-1256',
    notes,
  };
}

/** رمزگشایی تنها‌ٔ یک سلول بایتی با رمزگذاری از پیش‌تعیین‌شده. */
export function decoderFor(encoding: DecodedText['encoding']): (bytes: Buffer) => string {
  if (encoding === 'windows-1256') {
    const decoder = new TextDecoder('windows-1256');
    return (bytes) => decoder.decode(bytes);
  }
  if (encoding === 'ascii') {
    return (bytes) => bytes.toString('latin1');
  }
  return (bytes) => bytes.toString('utf8');
}
