/**
 * تجزیهٔ دامپ متنی SQL (دیالکت SQLite).
 *
 * همهٔ دستورها ابتدا از هم جدا و «allowlist» می‌شوند: فقط CREATE TABLE،
 * CREATE (UNIQUE) INDEX، INSERT، BEGIN، COMMIT و PRAGMA foreign_keys مجاز
 * است. هر دستور خطرناک (ATTACH، DROP، trigger، load_extension و …) با پیام
 * فارسی رد می‌شود؛ CREATE TABLE ... AS و INSERT ... SELECT/تابع نیز رد می‌شوند.
 * سپس دستورها در یک worker thread با timeout و سقف حافظه اجرا می‌شوند.
 * دامپ MySQL/PostgreSQL/SQL Server با پیام روشن و راهنمای خروجی رد می‌شود.
 */

import { SQLITE_CORRUPTED_MESSAGE } from '../constants/package-import.constants';
import { ParsedPackage } from './package-source.types';
import { openSqlite } from './sqlite.parser';
import { runStatementsInWorker, SqlWorkerError } from './sql-dump-worker';

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

/** حذف رشته‌ها و شناسه‌های نقل‌قول‌دار تا فقط «اسکلت» دستور برای بررسی بماند. */
function skeletonOf(statement: string): string {
  return statement
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]');
}

const SELECT_MESSAGE =
  'دستور CREATE TABLE ... AS و INSERT ... SELECT/WITH در دامپ SQL مجاز نیست؛ فقط INSERT ... VALUES با مقدارهای ساده پذیرفته می‌شود.';

/** اعتبارسنجی عمیق‌تر برای CREATE TABLE و INSERT (ضد کوئری‌های سنگین). */
function assertNoQueryForms(stripped: string): void {
  const skeleton = skeletonOf(stripped);
  if (/^CREATE\s+TABLE\b/i.test(skeleton)) {
    // CREATE [TEMP] TABLE [IF NOT EXISTS] name AS ... (CTAS) runs an arbitrary query.
    if (
      /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[^\s(]+(\s*\.\s*[^\s(]+)?\s+AS\b/i.test(
        skeleton,
      ) ||
      /\b(SELECT|WITH)\b/i.test(skeleton)
    ) {
      throw new SqlDumpParseError(SELECT_MESSAGE);
    }
    return;
  }
  if (/^INSERT\b/i.test(skeleton)) {
    const valuesAt = skeleton.search(/\bVALUES\b/i);
    if (valuesAt === -1) {
      throw new SqlDumpParseError(SELECT_MESSAGE);
    }
    const body = skeleton.slice(valuesAt + 6);
    // Any function call (zeroblob, randomblob, replace, ...) or subquery is rejected.
    if (/[A-Za-z_]\w*\s*\(/.test(body) || /\b(SELECT|WITH|FROM)\b/i.test(body)) {
      throw new SqlDumpParseError(SELECT_MESSAGE);
    }
    if (/\b(SELECT|WITH|RETURNING)\b/i.test(skeleton.slice(0, valuesAt))) {
      throw new SqlDumpParseError(SELECT_MESSAGE);
    }
  }
}

/** اعتبارسنجی یک دستور؛ در صورت غیرمجاز بودن خطای فارسی پرتاب می‌کند. */
export function assertAllowedStatement(statement: string): void {
  const stripped = stripLeadingComments(statement);
  if (!stripped) {
    return;
  }
  if (ALLOWED_STATEMENT_PATTERNS.some((pattern) => pattern.test(stripped))) {
    assertNoQueryForms(stripped);
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

/** راهنمای خروجی گرفتن به‌صورت قابل‌پذیرش (CSV/XLSX داخل ZIP). */
const EXPORT_HINT =
  'لطفاً از نرم‌افزار قبلی خود جدول‌ها را به‌صورت اکسل یا CSV خروجی بگیرید و همه را در یک فایل ZIP بارگذاری کنید (یا از همان نرم‌افزار خروجی SQLite بگیرید).';

export type ForeignDialect = 'mysql' | 'postgres' | 'mssql';

const DIALECT_LABEL: Record<ForeignDialect, string> = {
  mysql: 'MySQL/MariaDB',
  postgres: 'PostgreSQL',
  mssql: 'SQL Server',
};

/** تشخیص دامپ دیتابیس غیر SQLite از نشانه‌های رایج هر دیالکت. */
export function detectForeignDialect(text: string): ForeignDialect | null {
  const head = text.slice(0, 200_000);
  if (
    /^\s*--\s*(MySQL|MariaDB) dump/im.test(head) ||
    /\/\*!\d{5}/.test(head) ||
    /\bENGINE\s*=\s*(InnoDB|MyISAM)\b/i.test(head) ||
    /^\s*LOCK\s+TABLES\b/im.test(head) ||
    (/\bAUTO_INCREMENT\b/i.test(head) && /`/.test(head))
  ) {
    return 'mysql';
  }
  if (
    /PostgreSQL database dump/i.test(head) ||
    /^\s*COPY\s+\S+.*\bFROM\s+stdin\b/im.test(head) ||
    /^\s*SET\s+(statement_timeout|client_encoding|standard_conforming_strings)\b/im.test(head) ||
    /\bSELECT\s+pg_catalog\./i.test(head) ||
    /\bCREATE\s+SEQUENCE\b/i.test(head)
  ) {
    return 'postgres';
  }
  if (
    /^\s*GO\s*$/im.test(head) ||
    /^\s*SET\s+(ANSI_NULLS|QUOTED_IDENTIFIER|ANSI_PADDING)\b/im.test(head) ||
    /\[dbo\]\./i.test(head) ||
    /^\s*USE\s+\[[^\]]+\]/im.test(head) ||
    (/\bN'[^']*'/.test(head) && /\[\w+\]\.\[\w+\]/.test(head))
  ) {
    return 'mssql';
  }
  return null;
}

/** پیام فارسی خطا برای دامپ دیتابیس غیر SQLite. */
export function foreignDumpMessage(dialect: ForeignDialect): string {
  return `این فایل دامپ ${DIALECT_LABEL[dialect]} است و مستقیم پشتیبانی نمی‌شود (فقط دامپ SQLite). ${EXPORT_HINT}`;
}

/** پیام فارسی برای فایل‌های پشتیبان باینری SQL Server/PostgreSQL (.bak، .mdf، PGDMP). */
export const FOREIGN_BINARY_MESSAGE =
  `فایل پشتیبان باینری SQL Server (.bak/.mdf) یا PostgreSQL قابل خواندن نیست. ${EXPORT_HINT}`;

/** باز کردن دامپ SQL در دیتابیس درون‌حافظه و بازگرداندن جداول صفحه‌ای. */
export async function openSqlDump(text: string): Promise<ParsedPackage> {
  if (!text || !text.trim()) {
    throw new SqlDumpParseError('فایل SQL خالی است.');
  }

  const dialect = detectForeignDialect(text);
  if (dialect) {
    throw new SqlDumpParseError(foreignDumpMessage(dialect));
  }

  const statements = splitSqlStatements(text);
  if (statements.length === 0) {
    throw new SqlDumpParseError('فایل SQL هیچ دستور معتبری ندارد.');
  }
  for (const statement of statements) {
    assertAllowedStatement(statement);
  }

  let bytes: Buffer;
  try {
    bytes = await runStatementsInWorker(statements);
  } catch (error) {
    if (error instanceof SqlWorkerError) {
      if (error.reason === 'timeout') {
        throw new SqlDumpParseError(
          'اجرای دامپ SQL بیش از حد طول کشید و متوقف شد؛ فایل را به‌صورت CSV/XLSX بفرستید.',
        );
      }
      if (error.reason === 'oom' || error.reason === 'too_large') {
        throw new SqlDumpParseError(
          'حجم داده‌های دامپ SQL بیش از سقف مجاز است.',
        );
      }
    }
    throw new SqlDumpParseError(SQLITE_CORRUPTED_MESSAGE);
  }

  // The worker output is a plain SQLite file; reading it executes none of the customer's SQL.
  return openSqlite(bytes);
}
