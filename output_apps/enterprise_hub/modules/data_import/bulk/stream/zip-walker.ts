import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { maxExpansionRatio, maxUncompressedBytes, maxZipEntries } from '../bulk.constants';
import { ImportFileError } from './types';

export interface ZipEntryHandler {
  data(chunk: Uint8Array): void;
  end(): void;
}

export interface ZipWalkerOptions {
  /** Return a handler to read the entry, or null to skip it without inflating. */
  onEntry(name: string): ZipEntryHandler | null;
  onNote(message: string): void;
}

const SLICE = 16 * 1024;
const RATIO_CHECK_AFTER = 256 * 1024 * 1024;

/** `a/../b`, absolute paths, drive letters, backslashes, NULs: every way a name can escape a folder. */
export function isUnsafeZipPath(name: string): boolean {
  return (
    name.length === 0 ||
    name.length > 1024 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((part) => part === '..')
  );
}

/**
 * Walks a ZIP from a byte stream without ever holding more than a few KiB of compressed input. Output
 * is bounded per push by slicing the input to 16 KiB (deflate cannot expand beyond ~1032:1, so one push
 * never produces more than ~16 MiB). Guards: entry count, unsafe paths, nested archives, total expanded
 * size, and a global expansion-ratio check for bombs.
 */
export class ZipWalker {
  private readonly unzip: Unzip;
  private entries = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private current: ZipEntryHandler | null = null;
  private error: Error | null = null;

  constructor(private readonly options: ZipWalkerOptions) {
    this.unzip = new Unzip((file) => this.entry(file));
    this.unzip.register(UnzipInflate);
    this.unzip.register(UnzipPassThrough);
  }

  push(chunk: Uint8Array): void {
    for (let at = 0; at < chunk.length; at += SLICE) {
      const slice = chunk.subarray(at, Math.min(at + SLICE, chunk.length));
      this.bytesIn += slice.length;
      try {
        this.unzip.push(slice);
      } catch (error) {
        throw this.error ?? new ImportFileError(`ZIP خراب یا رمزدار است: ${(error as Error).message}`);
      }
      if (this.error) throw this.error;
    }
  }

  finish(): void {
    try {
      this.unzip.push(new Uint8Array(0), true);
    } catch {
      /* a truncated archive is reported by the caller through the entries it did get */
    }
    if (this.error) throw this.error;
  }

  private entry(file: { name: string; start(): void; ondata: (err: Error | null, data: Uint8Array, final: boolean) => void }): void {
    const name = file.name;
    if (name.endsWith('/')) return; // directory
    this.entries += 1;
    if (this.entries > maxZipEntries()) {
      this.error = new ImportFileError(`تعداد فایل‌های داخل ZIP بیش از ${maxZipEntries()} است.`);
      return;
    }
    if (isUnsafeZipPath(name)) {
      this.error = new ImportFileError('ZIP شامل مسیر ناامن است (خروج از پوشه) و رد شد.');
      return;
    }
    if (/\.(zip|7z|rar|gz|tgz)$/i.test(name)) {
      this.options.onNote(`«${name}»: آرشیو تودرتو نادیده گرفته شد؛ فایل‌های داخل آن را مستقیم در ZIP قرار دهید.`);
      return;
    }
    const handler = this.options.onEntry(name);
    if (!handler) {
      // Entries written with a data descriptor (Excel, streaming zippers) have no size up front, so fflate
      // has to inflate them to find where they end. Without a consumer it buffers everything; drain it.
      file.ondata = () => undefined;
      try {
        file.start();
      } catch {
        /* unsupported compression on an entry we do not want anyway */
      }
      return;
    }
    file.ondata = (err, data, final) => {
      if (err) {
        this.error = new ImportFileError(`ZIP خراب است: ${err.message}`);
        return;
      }
      this.bytesOut += data.length;
      if (this.bytesOut > maxUncompressedBytes()) {
        this.error = new ImportFileError('حجم بازشدهٔ ZIP از سقف مجاز بیشتر است.');
        return;
      }
      if (this.bytesOut > RATIO_CHECK_AFTER && this.bytesOut / Math.max(1, this.bytesIn) > maxExpansionRatio()) {
        this.error = new ImportFileError('نسبت فشرده‌سازی ZIP غیرعادی است (احتمال بمب فشرده‌سازی)؛ رد شد.');
        return;
      }
      try {
        if (data.length > 0) handler.data(data);
        if (final) handler.end();
      } catch (error) {
        this.error = error as Error;
      }
    };
    this.current = handler;
    file.start();
  }
}
