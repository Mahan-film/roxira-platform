/**
 * پل مشترک sql.js: بارگذاری موتور WASM و ساخت «خوانندهٔ جدول» از یک دیتابیس.
 *
 * هر دو مسیر SQLite باینری و دامپ SQL (که در یک دیتابیس درون‌حافظه اجرا
 * می‌شود) از همین کد خواندن صفحه‌ای استفاده می‌کنند تا حافظه کران‌دار بماند.
 */

import * as path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { PACKAGE_PAGE_SIZE } from '../constants/package-import.constants';
import {
  PackageColumn,
  PackageRelationship,
  PackageTableReader,
} from './package-source.types';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** بارگذاری یک‌بارهٔ موتور sql.js با محل فایل WASM در node_modules. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const distDir = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) => path.join(distDir, file),
    });
  }
  return sqlJsPromise;
}

/** نقل‌قول ایمن نام جدول/ستون برای درج در SQL. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** خوانندهٔ صفحه‌ای یک جدول در دیتابیس sql.js. */
class SqliteTableReader implements PackageTableReader {
  constructor(
    private readonly db: Database,
    readonly name: string,
    readonly columns: PackageColumn[],
    readonly rowCount: number,
  ) {}

  readPage(offset: number, limit: number): Record<string, unknown>[] {
    const stmt = this.db.prepare(
      `SELECT * FROM ${quoteIdentifier(this.name)} LIMIT ? OFFSET ?`,
    );
    try {
      stmt.bind([limit, offset]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
}

/** خواندن همه ردیف‌های یک پرس‌وجوی کوچک (PRAGMA) به‌صورت اشیاء. */
function queryAll(
  db: Database,
  sql: string,
): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

/** فهرست نام جدول‌های کاربر (بدون جداول داخلی sqlite_*). */
export function listUserTables(db: Database): string[] {
  const rows = queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows
    .map((row) => String(row.name ?? ''))
    .filter((name) => name.length > 0);
}

/** ساخت خواننده‌های صفحه‌ای و روابط اعلام‌شده از یک دیتابیس sql.js. */
export function buildPackageFromDatabase(db: Database): {
  tables: PackageTableReader[];
  relationships: PackageRelationship[];
} {
  const tables: PackageTableReader[] = [];
  const relationships: PackageRelationship[] = [];

  for (const name of listUserTables(db)) {
    const columnRows = queryAll(db, `PRAGMA table_info(${quoteIdentifier(name)})`);
    const columns: PackageColumn[] = columnRows.map((row) => ({
      name: String(row.name ?? ''),
      type: String(row.type ?? ''),
    }));

    const countRows = queryAll(
      db,
      `SELECT COUNT(*) AS c FROM ${quoteIdentifier(name)}`,
    );
    const rowCount = Number(countRows[0]?.c ?? 0);

    tables.push(new SqliteTableReader(db, name, columns, rowCount));

    const fkRows = queryAll(
      db,
      `PRAGMA foreign_key_list(${quoteIdentifier(name)})`,
    );
    for (const fk of fkRows) {
      const toTable = String(fk.table ?? '');
      const fromColumn = String(fk.from ?? '');
      const toColumn = String(fk.to ?? '');
      if (toTable && fromColumn && toColumn) {
        relationships.push({
          fromTable: name,
          fromColumn,
          toTable,
          toColumn,
          declared: true,
        });
      }
    }
  }

  return { tables, relationships };
}

/** خواندن یک صفحه با اندازه پیش‌فرض. */
export function pageSize(): number {
  return PACKAGE_PAGE_SIZE;
}
