/**
 * قالب‌هایی که «تشخیص» داده می‌شوند ولی عمداً خوانده نمی‌شوند. به‌جای خطای مبهم، راهنمای فارسی
 * دقیق می‌دهیم. دلیل هر مورد در docs/plan.md و docs/IMPORT_SUPPORT.md آمده است.
 */

import { sniffFileKind } from '../parsers/file-kind';
import { FormatReader, FormatId, UnsupportedFormatError } from './reader.types';

export const ACCESS_MESSAGE =
  'فایل Microsoft Access (‎.mdb/.accdb) مستقیم خوانده نمی‌شود. در Access برای هر جدول ' +
  'External Data ← Export ← Excel یا Text File را بزنید (یا با mdb-export جدول‌ها را CSV کنید)، ' +
  'سپس همهٔ فایل‌ها را یکجا (یا در یک ZIP) در همین صفحه رها کنید.';

export const MSSQL_BACKUP_MESSAGE =
  'پشتیبان SQL Server (‎.bak/.mdf/.ldf) فعلاً خوانده نمی‌شود: بازیابی آن نیاز به اجرای SQL Server در یک سندباکس ' +
  'جداگانهٔ بدون شبکه دارد که هنوز راه‌اندازی نشده است. دو راه فوری: ۱) در SSMS روی دیتابیس راست‌کلیک کنید: ' +
  'Tasks ← Generate Scripts ← «Schema and data» و فایل ‎.sql را بفرستید (اسکریپت T-SQL بدون اجرا خوانده می‌شود)؛ ' +
  '۲) Tasks ← Export Data به Excel/CSV. هرگز فایل ‎.bak را روی سرور تولید بازیابی نمی‌کنیم.';

export const PG_CUSTOM_MESSAGE =
  'این پشتیبان باینری PostgreSQL (pg_dump -Fc) است. آن را با «pg_restore -f out.sql فایل.dump» ' +
  'یا «pg_dump --format=plain» به متن تبدیل کنید و فایل ‎.sql را بفرستید.';

/** Reached only where OCR cannot run: inside a ZIP or a multi-file upload. A single upload goes through PackageOcrService. */
export const PDF_IMAGE_MESSAGE =
  'تصویر و PDF اسکن‌شده داخل ZIP یا چندفایلی خوانده نمی‌شوند؛ هر کدام را جداگانه بارگذاری کنید تا با OCR خوانده و سپس بازبینی شوند.';

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function guide(
  id: FormatId,
  labelFa: string,
  extensions: string[],
  message: string,
  detect: (buffer: Buffer, fileName: string) => number,
): FormatReader {
  return {
    id,
    labelFa,
    extensions,
    detect,
    read() {
      throw new UnsupportedFormatError(id, message);
    },
  };
}

export const accessReader = guide('access', 'Microsoft Access', ['.mdb', '.accdb'], ACCESS_MESSAGE, (buffer) => {
  const sig = buffer.subarray(4, 19).toString('latin1');
  return buffer.length > 32 && (sig === 'Standard Jet DB' || sig === 'Standard ACE DB') ? 0.98 : 0;
});

export const mssqlBackupReader = guide('mssql-backup', 'پشتیبان SQL Server', ['.bak', '.mdf', '.ndf', '.ldf'], MSSQL_BACKUP_MESSAGE, (buffer, fileName) => {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === 'TAPE') return 0.97;
  const ext = extension(fileName);
  if (['.mdf', '.ndf'].includes(ext) && buffer.length >= 8192 && buffer[0] === 0x01 && buffer[1] === 0x0f) return 0.9;
  if (['.bak', '.mdf', '.ndf', '.ldf'].includes(ext) && buffer.length > 8192) {
    // binary by extension only: low score so real text/known formats still win
    return buffer.subarray(0, 2048).includes(0) ? 0.4 : 0;
  }
  return 0;
});

export const pgCustomReader = guide('pg-custom', 'پشتیبان باینری PostgreSQL', ['.dump', '.backup'], PG_CUSTOM_MESSAGE, (buffer) =>
  buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === 'PGDMP' ? 0.98 : 0,
);

export const imageReader = guide('image', 'تصویر', ['.png', '.jpg', '.jpeg', '.webp'], PDF_IMAGE_MESSAGE, (buffer, name) =>
  sniffFileKind(buffer, name) === 'image' ? 0.99 : 0,
);
