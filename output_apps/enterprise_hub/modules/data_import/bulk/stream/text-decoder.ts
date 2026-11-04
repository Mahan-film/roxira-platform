import { ImportFileError } from './types';

const HEAD_BYTES = 64 * 1024;

/**
 * Detects the text encoding from the first 64 KiB, then decodes the rest incrementally. UTF-8, UTF-16
 * (BOM or obvious NUL pattern) and Windows-1256 (the Persian legacy default) are supported.
 */
export class PushTextDecoder {
  encoding = '';
  note = '';
  private head: Buffer[] = [];
  private headLen = 0;
  private decoder?: TextDecoder;

  push(chunk: Uint8Array): string[] {
    if (!this.decoder) {
      this.head.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      this.headLen += chunk.byteLength;
      if (this.headLen < HEAD_BYTES) return [];
      return [this.open(Buffer.concat(this.head))];
    }
    const text = this.decoder.decode(chunk, { stream: true });
    return text ? [text] : [];
  }

  end(): string[] {
    if (!this.decoder) {
      if (this.headLen === 0) return [];
      return [this.open(Buffer.concat(this.head), true)];
    }
    const tail = this.decoder.decode();
    return tail ? [tail] : [];
  }

  private open(head: Buffer, final = false): string {
    this.head = [];
    let skip = 0;
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
      this.encoding = 'utf-8';
      skip = 3;
    } else if (head[0] === 0xff && head[1] === 0xfe) {
      this.encoding = 'utf-16le';
      skip = 2;
    } else if (head[0] === 0xfe && head[1] === 0xff) {
      this.encoding = 'utf-16be';
      skip = 2;
    } else if (looksUtf16le(head)) {
      this.encoding = 'utf-16le';
    } else if (isValidUtf8Prefix(head, final)) {
      this.encoding = 'utf-8';
    } else {
      this.encoding = 'windows-1256';
      this.note = 'رمزگذاری فایل UTF-8 نبود و به‌صورت Windows-1256 خوانده شد.';
    }
    try {
      this.decoder = new TextDecoder(this.encoding, { fatal: false, ignoreBOM: true });
    } catch {
      throw new ImportFileError('رمزگذاری این فایل پشتیبانی نمی‌شود؛ آن را با UTF-8 ذخیره کنید.');
    }
    return this.decoder.decode(head.subarray(skip), { stream: !final });
  }
}

function looksUtf16le(head: Buffer): boolean {
  const n = Math.min(head.length, 2048) & ~1;
  if (n < 16) return false;
  let zeros = 0;
  for (let i = 1; i < n; i += 2) if (head[i] === 0) zeros += 1;
  return zeros > n / 2 / 2;
}

function isValidUtf8Prefix(head: Buffer, final: boolean): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // The sample may end inside a multi-byte sequence: allow dropping up to 3 trailing bytes.
  const tries = final ? [0] : [0, 1, 2, 3];
  for (const drop of tries) {
    try {
      decoder.decode(head.subarray(0, head.length - drop));
      return true;
    } catch {
      /* try a shorter prefix */
    }
  }
  return false;
}
