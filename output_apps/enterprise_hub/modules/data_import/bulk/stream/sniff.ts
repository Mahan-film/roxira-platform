export type SourceKind = 'csv' | 'sql' | 'xlsx' | 'zip' | 'legacy';

const LEGACY_EXTENSIONS = new Set(['.json', '.xml', '.ofx', '.qbo', '.qfx', '.iif', '.dbf', '.xls', '.ods', '.html', '.htm', '.prn', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb', '.bak', '.dump', '.backup']);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Chooses the reader from the file's content first (magic bytes), the extension second. Streaming kinds
 * (csv, sql, xlsx, zip) have no size limit; `legacy` kinds are read whole by the older readers.
 */
export function sniffSource(head: Buffer, fileName: string): SourceKind {
  const ext = extensionOf(fileName);
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) {
    const peek = head.toString('latin1', 0, Math.min(head.length, 16 * 1024));
    if (/^mimetype.{0,40}opendocument/i.test(peek.slice(30)) || ext === '.ods') return 'legacy';
    if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
    if (peek.includes('xl/') && peek.includes('[Content_Types].xml')) return 'xlsx';
    if (peek.includes('xl/workbook.xml') || peek.includes('xl/worksheets/')) return 'xlsx';
    return 'zip';
  }
  if (head.length >= 8 && head.toString('latin1', 0, 15) === 'SQLite format 3') return 'legacy';
  if (head.length >= 4 && head.readUInt32BE(0) === 0xd0cf11e0) return 'legacy';
  if (head.toString('latin1', 0, 5) === '%PDF-' || head.toString('latin1', 0, 5) === 'PGDMP') return 'legacy';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8) return 'legacy';
  if (head.length >= 4 && head.toString('latin1', 1, 4) === 'PNG') return 'legacy';
  if (ext === '.sql') return 'sql';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (LEGACY_EXTENSIONS.has(ext)) return 'legacy';
  const text = head.toString('utf8', 0, Math.min(head.length, 16 * 1024));
  if (/^\s*[[{]/.test(text) || /^\s*<(\?xml|[A-Za-z!])/.test(text)) return 'legacy';
  if (/\bINSERT\s+INTO\b|\bCOPY\s+\S+[^;]*\bFROM\s+stdin\b|\bCREATE\s+TABLE\b/i.test(text)) return 'sql';
  return 'csv';
}
