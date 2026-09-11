/**
 * رمزگشای مینیمال CBOR (Concise Binary Object Representation — RFC 8949).
 *
 * WebAuthn از CBOR برای `attestationObject` و کلید عمومی COSE استفاده می‌کند.
 * این پیاده‌سازی فقط زیرمجموعهٔ موردنیاز WebAuthn را پشتیبانی می‌کند:
 *   • عدد صحیح بدون علامت/منفی (major 0, 1)
 *   • رشته بایتی/متنی (major 2, 3)
 *   • آرایه/نقشه (major 4, 5)
 *   • مقادیر ساده و اعشاری (major 7)
 * نتیجه به‌صورت Uint8Array برای رشته‌های بایتی بازگردانده می‌شود.
 */
export class CborDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CborDecodeError';
  }
}

class CborDecoder {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private ensure(length: number): void {
    if (this.offset + length > this.bytes.length) {
      throw new CborDecodeError('پایان غیرمنتظره دادهٔ CBOR.');
    }
  }

  private readUint8(): number {
    this.ensure(1);
    return this.bytes[this.offset++];
  }

  private readUint16(): number {
    this.ensure(2);
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      2,
    );
    this.offset += 2;
    return view.getUint16(0, false);
  }

  private readUint32(): number {
    this.ensure(4);
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      4,
    );
    this.offset += 4;
    return view.getUint32(0, false);
  }

  private readUint64(): number {
    this.ensure(8);
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    );
    this.offset += 8;
    const high = view.getUint32(0, false);
    const low = view.getUint32(4, false);
    return high * 2 ** 32 + low;
  }

  /** خواندن طول از ۵ بیت پایین و بایت‌های تکمیلی. */
  private readLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.readUint8();
    if (additional === 25) return this.readUint16();
    if (additional === 26) return this.readUint32();
    if (additional === 27) return this.readUint64();
    throw new CborDecodeError('طول CBOR نامعتبر است.');
  }

  private readBytes(length: number): Uint8Array {
    this.ensure(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  decode(): unknown {
    const initial = this.readUint8();
    const major = initial >> 5;
    const additional = initial & 0x1f;

    switch (major) {
      case 0:
        return this.readLength(additional);
      case 1:
        return -1 - this.readLength(additional);
      case 2:
        return this.readBytes(this.readLength(additional));
      case 3:
        return new TextDecoder().decode(this.readBytes(this.readLength(additional)));
      case 4: {
        const length = this.readLength(additional);
        const items: unknown[] = [];
        for (let i = 0; i < length; i += 1) {
          items.push(this.decode());
        }
        return items;
      }
      case 5: {
        const length = this.readLength(additional);
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < length; i += 1) {
          const key = this.decode();
          const value = this.decode();
          map.set(key, value);
        }
        return map;
      }
      case 7:
        return this.readSimple(additional);
      default:
        throw new CborDecodeError(`نوع CBOR پشتیبانی نمی‌شود: ${major}`);
    }
  }

  private readSimple(additional: number): unknown {
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22) return null;
    if (additional === 23) return undefined;
    if (additional === 25) {
      // IEEE 754 half-precision
      const half = this.readUint16();
      const exponent = (half & 0x7c00) >> 10;
      const fraction = half & 0x03ff;
      const sign = half & 0x8000 ? -1 : 1;
      if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
      if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
      return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
    }
    if (additional === 26) {
      this.ensure(4);
      const view = new DataView(
        this.bytes.buffer,
        this.bytes.byteOffset + this.offset,
        4,
      );
      this.offset += 4;
      return view.getFloat32(0, false);
    }
    if (additional === 27) {
      this.ensure(8);
      const view = new DataView(
        this.bytes.buffer,
        this.bytes.byteOffset + this.offset,
        8,
      );
      this.offset += 8;
      return view.getFloat64(0, false);
    }
    return additional;
  }
}

/** رمزگشایی یک بافر CBOR به ساختار دادهٔ جاوااسکریپت. */
export function decodeCbor(bytes: Uint8Array): unknown {
  return new CborDecoder(bytes).decode();
}
