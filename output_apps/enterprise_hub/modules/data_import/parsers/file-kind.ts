/**
 * تشخیص نوع فایل بارگذاری‌شده بر پایه «اثر انگشت بایتی» (magic bytes) و نه
 * فقط پسوند/MIME اعلامی کلاینت. پسوند/MIME فقط زمانی به‌عنوان پشتیبان به کار
 * می‌رود که امضای بایتی شناخته‌شده‌ای وجود نداشته باشد (مثلاً CSV که امضای
 * واحدی ندارد).
 */

/** نوع فایل قابل بارگذاری در ورود داده. */
export type ImportFileKind = 'csv' | 'xlsx' | 'pdf' | 'image' | 'unknown';

function startsWithPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

function startsWithPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function startsWithJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function startsWithWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  );
}

function startsWithZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

/** تشخیص نوع فایل از روی محتوا (و در نهایت پسوند/MIME به‌عنوان پشتیبان). */
export function sniffFileKind(
  buffer: Buffer,
  filename = '',
  mimetype = '',
): ImportFileKind {
  if (startsWithPdf(buffer)) {
    return 'pdf';
  }
  if (startsWithPng(buffer) || startsWithJpeg(buffer) || startsWithWebp(buffer)) {
    return 'image';
  }
  if (startsWithZip(buffer)) {
    return 'xlsx';
  }
  const dot = filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  const mime = mimetype.toLowerCase();

  if (extension === '.csv') {
    return 'csv';
  }
  if (extension === '.xlsx') {
    return 'xlsx';
  }
  if (extension === '.pdf') {
    return 'pdf';
  }
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return 'image';
  }
  if (mime.includes('text/csv')) {
    return 'csv';
  }
  if (mime.includes('spreadsheetml')) {
    return 'xlsx';
  }
  return 'unknown';
}

/** MIME دقیق تصویر از روی امضای بایتی (برای ارسال data URL به مدل بینایی). */
export function imageMimeType(buffer: Buffer): string | null {
  if (startsWithPng(buffer)) {
    return 'image/png';
  }
  if (startsWithJpeg(buffer)) {
    return 'image/jpeg';
  }
  if (startsWithWebp(buffer)) {
    return 'image/webp';
  }
  return null;
}
