import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { TenantExportRepository } from '../repositories/tenant-export.repository';

export interface TenantExportMetadata {
  tenantId: string;
  exportedAt: string;
  version: string;
  tableCounts: Record<string, number>;
  checksum: string;
}

export interface TenantJsonArchive {
  metadata: TenantExportMetadata;
  data: Record<string, any[]>;
}

export interface TabularTable {
  headers: string[];
  rows: string[][];
}

export interface TenantTabularExport {
  metadata: TenantExportMetadata;
  tables: Record<string, TabularTable>;
}

export interface ExportFileEntry {
  path: string;
  module: string;
  table?: string;
  format: 'xml' | 'csv' | 'json';
  sizeBytes: number;
  recordCount: number;
  sha256: string;
}

export interface TenantExportManifest {
  tenantId: string;
  exportedAt: string;
  version: string;
  standard: string;
  rootHash: string;
  totalRecords: number;
  totalFiles: number;
  files: ExportFileEntry[];
}

export interface TenantGoBDZ3Archive {
  manifest: TenantExportManifest;
  indexXml: string;
  files: Record<string, string>;
}

export const TABLE_MODULE_MAP: Record<string, { module: string; description: string }> = {
  fin_chart_of_accounts: { module: 'accounting', description: 'Chart of accounts master data' },
  fin_journal_entries: { module: 'accounting', description: 'General ledger journal entries' },
  fin_journal_entry_lines: { module: 'accounting', description: 'General ledger entry lines' },
  fin_cheques: { module: 'treasury', description: 'Cheques register' },
  erp_parties: { module: 'commercial', description: 'Customers and vendors master data' },
  invoices: { module: 'commercial', description: 'Commercial invoices' },
  erp_stock_items: { module: 'inventory', description: 'Inventory stock items' },
};

@Injectable()
export class TenantExportService {
  constructor(private readonly exportRepo: TenantExportRepository) {}

  /**
   * Neutralizes formula injection attack vectors (=, +, -, @, \t, \r) per Lesson 9 and security standard #686.
   * Handles leading spaces or newlines before formula symbols.
   */
  sanitizeCellForSpreadsheet(val: any): string {
    if (val === null || val === undefined) {
      return '';
    }
    const str = String(val);
    const trimmed = str.replace(/^[ \n]+/, '');
    if (/^[=+\-@\t\r]/.test(trimmed)) {
      return `'${str}`;
    }
    return str;
  }

  /**
   * Builds full JSON archive of core tenant tables with cryptographic checksum and metadata.
   * All data queries run inside TenantScope with tenant_id filters.
   */
  async exportTenantJson(
    tenantId: string,
    preloadedData?: Record<string, any[]>,
  ): Promise<TenantJsonArchive> {
    const tablesData = preloadedData ?? (await this.exportRepo.fetchTenantData(tenantId));

    const tableCounts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(tablesData)) {
      tableCounts[table] = (rows || []).length;
    }

    const exportedAt = new Date().toISOString();
    const version = '1.0';

    // Cryptographic checksum covers the archive content (metadata details + data payload)
    const contentToHash = JSON.stringify({
      tenantId,
      exportedAt,
      version,
      tableCounts,
      data: tablesData,
    });
    const checksum = crypto.createHash('sha256').update(contentToHash).digest('hex');

    return {
      metadata: {
        tenantId,
        exportedAt,
        version,
        tableCounts,
        checksum,
      },
      data: tablesData,
    };
  }

  /**
   * Builds Excel-ready tabular sheets per core table with cell formula sanitization and checksum.
   */
  async exportTenantTabular(
    tenantId: string,
    preloadedData?: Record<string, any[]>,
  ): Promise<TenantTabularExport> {
    const tablesData = preloadedData ?? (await this.exportRepo.fetchTenantData(tenantId));

    const tables: Record<string, TabularTable> = {};
    const tableCounts: Record<string, number> = {};

    for (const [table, rows] of Object.entries(tablesData)) {
      tableCounts[table] = (rows || []).length;
      if (!rows || rows.length === 0) {
        tables[table] = { headers: [], rows: [] };
        continue;
      }

      // Collect unique headers across rows
      const headerSet = new Set<string>();
      rows.forEach((r) => Object.keys(r || {}).forEach((k) => headerSet.add(k)));
      const headers = Array.from(headerSet);

      const tabularRows = rows.map((r) =>
        headers.map((h) => this.sanitizeCellForSpreadsheet(r[h])),
      );

      tables[table] = { headers, rows: tabularRows };
    }

    const exportedAt = new Date().toISOString();
    const version = '1.0';

    const contentToHash = JSON.stringify({
      tenantId,
      exportedAt,
      version,
      tableCounts,
      tables,
    });
    const checksum = crypto.createHash('sha256').update(contentToHash).digest('hex');

    return {
      metadata: {
        tenantId,
        exportedAt,
        version,
        tableCounts,
        checksum,
      },
      tables,
    };
  }

  /**
   * Generates GDPdU-compliant index.xml conforming to GoBD Z3 Datenträgerüberlassung standard.
   */
  generateGoBDIndexXml(tenantId: string, tablesData: Record<string, any[]>): string {
    const tableNodes: string[] = [];

    for (const [table, rows] of Object.entries(tablesData)) {
      const mapping = TABLE_MODULE_MAP[table] || { module: 'general', description: table };
      const safeRows = rows || [];
      const headerSet = new Set<string>();
      safeRows.forEach((r) => Object.keys(r || {}).forEach((k) => headerSet.add(k)));
      const headers = Array.from(headerSet);

      const colDefs = headers.map((col) => {
        let typeXml = '<AlphaNumeric/>';
        const lowerCol = col.toLowerCase();
        if (['date', 'time', 'created_at', 'updated_at'].some((k) => lowerCol.includes(k))) {
          typeXml = '<Date><Format>YYYY-MM-DD</Format></Date>';
        } else if (['amount', 'balance', 'debit', 'credit', 'price', 'count', 'quantity', 'rate', 'cost'].some((k) => lowerCol.includes(k))) {
          // money-ok: schema column name matching for GDPdU index.xml type classification
          typeXml = '<Numeric/>';
        }
        return `            <VariableColumn>
              <Name>${col}</Name>
              <Description>${col}</Description>
              ${typeXml}
            </VariableColumn>`;
      });

      const pkXml = headers.includes('id')
        ? `\n          <VariablePrimaryKey>\n            <Column>id</Column>\n          </VariablePrimaryKey>`
        : '';

      tableNodes.push(`      <Table>
        <URL>${mapping.module}/${table}.csv</URL>
        <Name>${table}</Name>
        <Description>${mapping.description}</Description>
        <Validity>
          <RangeFrom>2000-01-01</RangeFrom>
          <RangeTo>2099-12-31</RangeTo>
        </Validity>
        <DecimalSymbol>,</DecimalSymbol>
        <DigitGroupingSymbol>.</DigitGroupingSymbol>
        <VariableLength>
          <ColumnDelimiter>;</ColumnDelimiter>
          <RecordDelimiter>&#13;&#10;</RecordDelimiter>
          <TextEncapsulator>"</TextEncapsulator>${pkXml}
${colDefs.join('\n')}
        </VariableLength>
      </Table>`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>Roxira Enterprise Hub</Name>
    <Location>Germany / EU</Location>
    <Comment>GoBD Z3 / EU Data Act Tenant Export (Tenant: ${tenantId})</Comment>
  </DataSupplier>
  <Media>
    <Name>Media 1</Name>
${tableNodes.join('\n')}
  </Media>
</DataSet>
`;
  }

  /**
   * Generates semicolon-delimited CSV with cell formula sanitization and RFC-4180 escaping.
   */
  generateModuleCsv(table: string, rows: any[]): string {
    if (!rows || rows.length === 0) {
      return '';
    }
    const headerSet = new Set<string>();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => headerSet.add(k)));
    const headers = Array.from(headerSet);

    const escapeCsvField = (val: any): string => {
      const sanitized = this.sanitizeCellForSpreadsheet(val);
      if (
        sanitized.includes(';') ||
        sanitized.includes('"') ||
        sanitized.includes('\n') ||
        sanitized.includes('\r')
      ) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    };

    const headerLine = headers.map(escapeCsvField).join(';');
    const lines = rows.map((r) => headers.map((h) => escapeCsvField(r[h])).join(';'));
    return [headerLine, ...lines].join('\r\n') + '\r\n';
  }

  /**
   * Builds the export manifest containing cryptographic SHA-256 hashes for every file and the Merkle root hash.
   */
  buildManifest(
    tenantId: string,
    files: Record<string, string>,
    tableCounts: Record<string, number>,
  ): TenantExportManifest {
    const exportedAt = new Date().toISOString();
    const version = 'GoBD-Z3/2026';
    const standard = 'EU Data Act Art. 6 / GoBD Z3 (Datenträgerüberlassung)';

    const entries: ExportFileEntry[] = [];
    let totalRecords = 0;

    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === 'manifest.json') continue;
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

      let format: 'xml' | 'csv' | 'json' = 'json';
      if (filePath.endsWith('.xml')) format = 'xml';
      else if (filePath.endsWith('.csv')) format = 'csv';

      let module = 'meta';
      let table: string | undefined;
      const parts = filePath.split('/');
      if (parts.length === 2) {
        module = parts[0];
        table = parts[1].replace(/\.(csv|json)$/, '');
      }

      const recordCount = table ? (tableCounts[table] ?? 0) : 0;
      if (format === 'json' && table) {
        totalRecords += recordCount;
      }

      entries.push({
        path: filePath,
        module,
        table,
        format,
        sizeBytes,
        recordCount,
        sha256,
      });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    const rootHash = crypto
      .createHash('sha256')
      .update(entries.map((e) => `${e.path}:${e.sha256}`).join('\n'))
      .digest('hex');

    return {
      tenantId,
      exportedAt,
      version,
      standard,
      rootHash,
      totalRecords,
      totalFiles: entries.length,
      files: entries,
    };
  }

  /**
   * Generates full tenant export bundle for GoBD Z3 & EU Data Act compliance (#1057 / T262 R26).
   * Includes index.xml, CSV and JSON per module, and manifest.json with SHA-256 file hashes.
   */
  async exportTenantGoBDZ3(
    tenantId: string,
    preloadedData?: Record<string, any[]>,
  ): Promise<TenantGoBDZ3Archive> {
    const tablesData = preloadedData ?? (await this.exportRepo.fetchTenantData(tenantId));
    const tableCounts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(tablesData)) {
      tableCounts[table] = (rows || []).length;
    }

    const files: Record<string, string> = {};

    // 1. Generate index.xml
    const indexXml = this.generateGoBDIndexXml(tenantId, tablesData);
    files['index.xml'] = indexXml;

    // 2. Generate per-module CSV & JSON files
    for (const [table, rows] of Object.entries(tablesData)) {
      const mapping = TABLE_MODULE_MAP[table] || { module: 'general', description: table };
      const csvContent = this.generateModuleCsv(table, rows);
      const jsonContent = JSON.stringify(rows || [], null, 2);

      files[`${mapping.module}/${table}.csv`] = csvContent;
      files[`${mapping.module}/${table}.json`] = jsonContent;
    }

    // 3. Generate Manifest
    const manifest = this.buildManifest(tenantId, files, tableCounts);
    files['manifest.json'] = JSON.stringify(manifest, null, 2);

    return {
      manifest,
      indexXml,
      files,
    };
  }
}
