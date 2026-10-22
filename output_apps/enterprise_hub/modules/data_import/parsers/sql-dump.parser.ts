/**
 * تجزیهٔ دامپ متنی SQL (دیالکت SQLite).
 *
 * همهٔ دستورها ابتدا از هم جدا و «allowlist» می‌شوند: فقط CREATE TABLE،
 * CREATE (UNIQUE) INDEX، INSERT، BEGIN، COMMIT و PRAGMA foreign_keys مجاز
 * است. هر دستور خطرناک (ATTACH، DROP، trigger، load_extension و …) با پیام
 * فارسی رد می‌شود. سپس دستورها در یک دیتابیس درون‌حافظه اجرا می‌شوند.
 */

import { SQLITE_CORRUPTED_MESSAGE } from '../constants/package-import.constants';
import { ParsedPackage } from './package-source.types';
import { buildPackageFromDatabase, loadSqlJs } from './sqljs-common';

/** خطای تجزیهٔ دامپ SQL. */
export class SqlDumpParseError extends Error {}

/** حذف کامنت‌های ابتدای یک دستور برای تشخیص نوع آن. */
function stripLeadingComments(statement: string): string {
  let text = statement.trim();
  for (;;) {
    if (text.startsWith('--')) {
      const end = text.indexOf('\n');
      text = end === -1 ? '' : text.slice(end + 1).trim();
      continue;
    }
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/');
      text = end === -1 ? '' : text.slice(end + 2).trim();
      continue;
    }
    return text;
  }
}

/**
 * جدا کردن دستورهای SQL با احترام به رشته‌ها، شناسه‌های نقل‌قول‌دار و
 * کامنت‌ها. نقطه‌ویرگول داخل رشته یا کامنت، دستور را نمی‌شکند.
 */
export function splitSqlStatements(text: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
      }
      index += 1;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote && quote !== ']') {
          current += next;
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      current += ' ';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      current += ' ';
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      index += 1;
      continue;
    }
    if (char === '[') {
      quote = ']';
      current += char;
      index += 1;
      continue;
    }
    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

const ALLOWED_STATEMENT_PATTERNS: RegExp[] = [
  /^CREATE\s+TABLE\b/i,
  /^CREATE\s+(UNIQUE\s+)?INDEX\b/i,
  /^INSERT\s+(OR\s+(IGNORE|REPLACE)\s+)?INTO\b/i,
  /^BEGIN(\s+(TRANSACTION|DEFERRED|IMMEDIATE|EXCLUSIVE))?\b/i,
  /^COMMIT(\s+TRANSACTION)?\b/i,
  /^END(\s+TRANSACTION)?\b/i,
  /^PRAGMA\s+foreign_keys\b/i,
];

/** اعتبارسنجی یک دستور؛ در صورت غیرمجاز بودن خطای فارسی پرتاب می‌کند. */
export function assertAllowedStatement(statement: string): void {
  const stripped = stripLeadingComments(statement);
  if (!stripped) {
    return;
  }
  if (ALLOWED_STATEMENT_PATTERNS.some((pattern) => pattern.test(stripped))) {
    return;
  }
  const firstWord = stripped.split(/\s+/, 1)[0] ?? '';
  const forbidden = /^(ATTACH|DETACH|DROP|DELETE|UPDATE|ALTER|VACUUM|REINDEX)$/i.test(
    firstWord,
  );
  const message = forbidden
    ? `دستور «${firstWord.toUpperCase()}» در دامپ SQL مجاز نیست.`
    : 'فقط دستورهای CREATE TABLE/INSERT/BEGIN/COMMIT/PRAGMA foreign_keys در دامپ SQL مجاز است.';
  throw new SqlDumpParseError(message);
}

/** باز کردن دامپ SQL در دیتابیس درون‌حافظه و بازگرداندن جداول صفحه‌ای. */
export async function openSqlDump(text: string): Promise<ParsedPackage> {
  if (!text || !text.trim()) {
    throw new SqlDumpParseError('فایل SQL خالی است.');
  }

  const statements = splitSqlStatements(text);
  if (statements.length === 0) {
    throw new SqlDumpParseError('فایل SQL هیچ دستور معتبری ندارد.');
  }
  for (const statement of statements) {
    assertAllowedStatement(statement);
  }

  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    for (const statement of statements) {
      db.run(statement);
    }
  } catch {
    db.close();
    throw new SqlDumpParseError(SQLITE_CORRUPTED_MESSAGE);
  }

  const { tables, relationships } = buildPackageFromDatabase(db);
  return {
    tables,
    relationships,
    close: () => db.close(),
  };
}
