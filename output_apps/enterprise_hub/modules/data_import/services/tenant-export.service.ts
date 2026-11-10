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
    const trimmed = str.trimStart();
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
}
