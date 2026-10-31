/**
 * خواننده ZIP مشترک بین XLSX و بستهٔ ZIP با «سقف واقعی حجم بازشده».
 *
 * اندازه‌های اعلام‌شده در هدر ZIP قابل اعتماد نیستند (یک فایل چندکیلوبایتی
 * می‌تواند گیگابایت باز شود)؛ بنابراین هر ورودی با `maxOutputLength` باز می‌شود
 * و مجموع بایت‌های بازشده در یک «بودجه» مشترک حساب می‌شود.
 */

import { inflateRawSync } from "zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT_LENGTH = 0xffff;

/** خطای ZIP؛ پیام فارسی توسط فراخوان تعیین می‌شود. */
export class ZipReadError extends Error {
  constructor(readonly code: "invalid" | "too_large" | "unsupported") {
    super(code);
  }
}

/** بودجهٔ مشترک بایت‌های بازشده (مقدار `remaining` با هر ورودی کم می‌شود). */
export interface InflateBudget {
  remaining: number;
}

/** نگاشت یک فایل داخل آرشیو ZIP. */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  declaredSize: number;
  localOffset: number;
}

/** یافتن امضای «پایان فهرست مرکزی» (EOCD) از انتهای بافر. */
export function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 22 - MAX_COMMENT_LENGTH);
  for (let pos = buffer.length - 22; pos >= earliest; pos -= 1) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) {
      return pos;
    }
  }
  return -1;
}

/** خواندن فهرست مرکزی ZIP (فهرست به‌ترتیب آرشیو؛ نام تکراری نگه داشته می‌شود). */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    throw new ZipReadError("invalid");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (
      pos + 46 > buffer.length ||
      buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE
    ) {
      throw new ZipReadError("invalid");
    }
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    if (pos + 46 + nameLength > buffer.length) {
      throw new ZipReadError("invalid");
    }
    entries.push({
      name: buffer
        .toString("utf8", pos + 46, pos + 46 + nameLength)
        .replace(/^[./]+/, ""),
      method: buffer.readUInt16LE(pos + 10),
      compressedSize: buffer.readUInt32LE(pos + 20),
      declaredSize: buffer.readUInt32LE(pos + 24),
      localOffset: buffer.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * استخراج یک ورودی با رعایت بودجه. اندازهٔ واقعی (نه اعلام‌شده) سنجیده می‌شود:
 * zlib در لحظهٔ عبور از `maxOutputLength` متوقف می‌شود و حافظهٔ اضافه نمی‌گیرد.
 */
export function extractZipEntry(
  buffer: Buffer,
  entry: ZipEntry,
  budget: InflateBudget,
): Buffer {
  const local = entry.localOffset;
  if (
    local + 30 > buffer.length ||
    buffer.readUInt32LE(local) !== LOCAL_SIGNATURE
  ) {
    throw new ZipReadError("invalid");
  }
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  if (start + entry.compressedSize > buffer.length) {
    throw new ZipReadError("invalid");
  }
  const data = buffer.subarray(start, start + entry.compressedSize);

  let out: Buffer;
  if (entry.method === 0) {
    if (data.length > budget.remaining) {
      throw new ZipReadError("too_large");
    }
    out = Buffer.from(data);
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(data, {
        maxOutputLength: Math.max(1, budget.remaining),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
        throw new ZipReadError("too_large");
      }
      throw new ZipReadError("invalid");
    }
    if (out.length > budget.remaining) {
      throw new ZipReadError("too_large");
    }
  } else {
    throw new ZipReadError("unsupported");
  }
  budget.remaining -= out.length;
  return out;
}
