import { maxPackageRows } from '../constants/package-import.constants';

/** سقف‌های سخت خوانندگان؛ همه برای مقابله با فایل خصمانه‌اند. */
export const READER_LIMITS = {
  /** حداکثر طول یک سلول؛ بیشتر بریده می‌شود و در یادداشت‌ها می‌آید. */
  maxCellChars: 32_768,
  maxColumns: 512,
  maxTables: 200,
  /** حداکثر کل سلول‌های یک بسته (ردیف × ستون). */
  maxCells: 8_000_000,
  maxXmlDepth: 64,
  maxXmlNodes: 2_000_000,
  maxJsonDepth: 48,
  /** حداکثر حجم JSON/XML/HTML که به‌صورت یکجا تجزیه می‌شود. */
  maxTreeBytes: 64 * 1024 * 1024,
  maxZipDepth: 1,
  maxSheetsPerWorkbook: 64,
};

export function rowLimit(): number {
  return maxPackageRows();
}
