import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { strToU8, zipSync } from 'fflate';
import { analysePackage } from './analysis/package-analysis';
import {
  assertAllowedStatement,
  openSqlDump,
  SqlDumpParseError,
} from './parsers/sql-dump.parser';
import { openSqlite, SqliteParseError } from './parsers/sqlite.parser';
import { parseZipPackage } from './parsers/zip.parser';
import { loadSqlJs } from './parsers/sqljs-common';
import { AccountingAccountsRegistry } from './registry/accounting-accounts.registry';
import { AccountingJournalLinesRegistry } from './registry/accounting-journal-lines.registry';
import { AccountingOpeningBalancesRegistry } from './registry/accounting-opening-balances.registry';
import { CrmActivitiesRegistry } from './registry/crm-activities.registry';
import { CrmLeadsRegistry } from './registry/crm-leads.registry';
import { EntityImportAdapter } from './registry/import-registry.types';
import { HrEmployeesRegistry } from './registry/hr-employees.registry';
import { InventoryItemsRegistry } from './registry/inventory-items.registry';
import { SalesInvoicesRegistry } from './registry/sales-invoices.registry';

function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name));
}

/** آداپتورهای تشخیص؛ سرویس‌های ماژول مالک فقط در commit لازم‌اند. */
function buildAdapters(): EntityImportAdapter[] {
  const stub = {} as never;
  return [
    new CrmLeadsRegistry(stub),
    new HrEmployeesRegistry(stub),
    new InventoryItemsRegistry(stub),
    new AccountingAccountsRegistry(stub),
    new AccountingOpeningBalancesRegistry(stub),
    new AccountingJournalLinesRegistry(stub),
    new SalesInvoicesRegistry(stub),
    new CrmActivitiesRegistry(stub),
  ] as unknown as EntityImportAdapter[];
}

/** ساخت متن دامپ SQL از فایل نمونه با کمک sql.js (برای تست مسیر .sql). */
async function buildSqlDump(buffer: Buffer): Promise<string> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );
  const statements: string[] = [];

  const encode = (value: unknown): string => {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (value instanceof Uint8Array) {
      return `X'${Buffer.from(value).toString('hex')}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  };

  try {
    const master = db.exec(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    const rows = master[0]?.values ?? [];
    for (const row of rows) {
      const name = String(row[0]);
      statements.push(`${String(row[1])};`);
      const data = db.exec(`SELECT * FROM "${name}"`);
      for (const table of data) {
        for (const values of table.values) {
          statements.push(
            `INSERT INTO "${name}" VALUES (${values.map(encode).join(',')});`,
          );
        }
      }
    }
  } finally {
    db.close();
  }

  return statements.join('\n');
}

describe('package import — analyze small SQLite fixture', () => {
  it('detects entities, the TafziliCode relationship, health and currencies', async () => {
    const parsed = await openSqlite(fixture('erp_multicurrency_small.sqlite'));
    try {
      const analysis = analysePackage(
        parsed.tables,
        buildAdapters(),
        parsed.relationships,
      );

      expect(analysis.tables).toHaveLength(7);

      const byName = new Map(analysis.tables.map((table) => [table.name, table]));
      expect(byName.get('tbl_Accounts_Coding')?.detectedEntity).toBe(
        'accounting-accounts',
      );
      expect(byName.get('tbl_Moshtarian_Peymankaran')?.detectedEntity).toBe(
        'crm-leads',
      );
      expect(byName.get('tbl_Kala_Anbar')?.detectedEntity).toBe(
        'inventory-items',
      );
      expect(byName.get('tbl_Factorha_Kharid_Foroosh')?.detectedEntity).toBe(
        'sales-invoices',
      );
      expect(byName.get('tbl_Sanad_Hesabdari_Riz')?.detectedEntity).toBe(
        'accounting-journal-lines',
      );
      expect(byName.get('tbl_CRM_Leads_Activities')?.detectedEntity).toBe(
        'crm-activities',
      );
      // جدول معاملهٔ ارزی پیش‌فرض نگاشت نمی‌شود.
      expect(byName.get('tbl_Havalejat_Arzi_Exchange')?.detectedEntity).toBeNull();

      const relationship = analysis.relationships.find(
        (item) =>
          item.fromColumn === 'TafziliCode' &&
          item.toTable === 'tbl_Moshtarian_Peymankaran',
      );
      expect(relationship).toBeDefined();
      expect(relationship?.matchRatio).toBeGreaterThanOrEqual(0.95);

      expect(analysis.health.checks.every((check) => check.level === 'ok')).toBe(
        true,
      );

      const aed = analysis.currencies.find((item) => item.raw === 'درهم');
      expect(aed?.normalized).toBe('AED');
      expect(aed?.count ?? 0).toBeGreaterThan(0);
    } finally {
      parsed.close();
    }
  });

  it('rejects the corrupted fixture with the Persian error', async () => {
    await expect(
      openSqlite(fixture('erp_corrupted_truncated.sqlite')),
    ).rejects.toBeInstanceOf(SqliteParseError);
    await expect(
      openSqlite(fixture('erp_corrupted_truncated.sqlite')),
    ).rejects.toThrow(/آسیب دیده/);
  });
});

describe('package import — SQL dump source', () => {
  it('round-trips the fixture through a generated .sql dump', async () => {
    const sqlText = await buildSqlDump(
      fixture('erp_multicurrency_small.sqlite'),
    );
    const parsed = await openSqlDump(sqlText);
    try {
      const analysis = analysePackage(
        parsed.tables,
        buildAdapters(),
        parsed.relationships,
      );
      const byName = new Map(analysis.tables.map((table) => [table.name, table]));
      expect(byName.get('tbl_Sanad_Hesabdari_Riz')?.detectedEntity).toBe(
        'accounting-journal-lines',
      );
      expect(byName.get('tbl_Moshtarian_Peymankaran')?.detectedEntity).toBe(
        'crm-leads',
      );
    } finally {
      parsed.close();
    }
  });

  it('rejects a malicious dump with ATTACH', async () => {
    expect(() =>
      assertAllowedStatement("ATTACH DATABASE 'evil.db' AS evil"),
    ).toThrow(SqlDumpParseError);
    await expect(
      openSqlDump("ATTACH DATABASE 'evil.db' AS evil;"),
    ).rejects.toBeInstanceOf(SqlDumpParseError);
  });
});

describe('package import — ZIP of CSV files', () => {
  it('turns each CSV into a table', () => {
    const zip = zipSync({
      'accounts.csv': strToU8('code,name\n1010,نقد\n1020,بانک'),
      'items.csv': strToU8('sku,name,quantity\nSKU1,کالا ۱,5'),
    });
    const parsed = parseZipPackage(Buffer.from(zip));
    try {
      const names = parsed.tables.map((table) => table.name).sort();
      expect(names).toEqual(['accounts', 'items']);
      expect(parsed.tables.find((table) => table.name === 'items')?.rowCount).toBe(
        1,
      );
    } finally {
      parsed.close();
    }
  });
});
