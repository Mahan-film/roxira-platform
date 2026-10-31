/**
 * قرارداد «خوانندهٔ قالب» (pluggable format reader).
 *
 * هر قالب فایل (CSV، XLS، DBF، دامپ MySQL، IIF …) یک خواننده است که
 * ۱) از روی «محتوا» امتیاز تشخیص می‌دهد و ۲) بایت‌ها را به همان `ParsedPackage`
 * صفحه‌ای تبدیل می‌کند که تحلیل/نگاشت/ثبت/undo موجود می‌شناسند.
 * هیچ خواننده‌ای کد یا SQL مشتری را اجرا نمی‌کند.
 */

import { ParsedPackage } from '../parsers/package-source.types';

export type FormatId =
  | 'sqlite'
  | 'sql'
  | 'sql-mysql'
  | 'sql-postgres'
  | 'sql-mssql'
  | 'zip'
  | 'multi'
  | 'csv'
  | 'tsv'
  | 'fixed-width'
  | 'json'
  | 'xml'
  | 'html-table'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'dbf'
  | 'iif'
  | 'ofx'
  | 'access'
  | 'mssql-backup'
  | 'pg-custom'
  | 'pdf'
  | 'image'
  | 'unknown';

/** زمینهٔ خواندن: نام فایل و عمق تودرتو (ZIP داخل ZIP ممنوع است). */
export interface ReadContext {
  fileName: string;
  depth: number;
}

export interface FormatReader {
  readonly id: FormatId;
  readonly labelFa: string;
  /** پسوندهای رایج؛ فقط برای شکستن تساوی امتیاز، هرگز مبنای تشخیص نیست. */
  readonly extensions: readonly string[];
  /** امتیاز ۰ تا ۱ از روی محتوا؛ ۰ یعنی این قالب نیست. */
  detect(buffer: Buffer, fileName: string): number;
  read(buffer: Buffer, ctx: ReadContext): Promise<ParsedPackage> | ParsedPackage;
}

/** خطای قابل‌نمایش به کاربر (پیام فارسی). */
export class ReaderError extends Error {}

/** قالبی که تشخیص داده می‌شود ولی عمداً خوانده نمی‌شود؛ پیام همان راهنماست. */
export class UnsupportedFormatError extends ReaderError {
  constructor(
    readonly formatId: FormatId,
    message: string,
  ) {
    super(message);
  }
}
