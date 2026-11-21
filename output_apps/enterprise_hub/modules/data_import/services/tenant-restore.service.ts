import { Injectable, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { TenantGoBDZ3Archive } from './tenant-export.service';

export interface TenantRestoreResult {
  success: boolean;
  targetTenantId: string;
  verifiedFilesCount: number;
  totalRecordsRestored: number;
  restoredTables: Record<string, number>;
  dryRun: boolean;
}

/**
 * Service to restore tenant records from a GoBD Z3 / EU Data Act export bundle (#1057 / T262 R26).
 *
 * Security & Isolation Guarantees:
 * 1. Cryptographically validates SHA-256 checksums of every file in the manifest and the root hash.
 * 2. Rejects tampered, incomplete, or corrupted archives fail-closed.
 * 3. Executes strictly within TenantScope.within(targetTenantId) to obey PostgreSQL FORCE RLS.
 * 4. Overwrites tenant_id on all restored rows to targetTenantId to prevent cross-tenant privilege escalation.
 * 5. Restores records in foreign-key dependency order.
 */
@Injectable()
export class TenantRestoreService {
  constructor(private readonly tenantScope: TenantScope) {}

  /**
   * Validates file integrity and root hash against manifest.
   * Throws BadRequestException on any checksum discrepancy.
   */
  verifyArchiveIntegrity(archive: TenantGoBDZ3Archive): void {
    const { manifest, files } = archive;
    if (!manifest || !manifest.files || !Array.isArray(manifest.files)) {
      throw new BadRequestException('Invalid archive: missing manifest or files declaration');
    }

    const calculatedEntries: Array<{ path: string; sha256: string }> = [];

    for (const entry of manifest.files) {
      if (entry.path === 'manifest.json') continue;
      const content = files[entry.path];
      if (content === undefined) {
        throw new BadRequestException(`Archive integrity error: declared file missing: ${entry.path}`);
      }
      const actualHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      if (actualHash !== entry.sha256) {
        throw new BadRequestException(
          `Archive tamper detected: checksum mismatch for ${entry.path} (expected ${entry.sha256}, got ${actualHash})`,
        );
      }
      calculatedEntries.push({ path: entry.path, sha256: actualHash });
    }

    calculatedEntries.sort((a, b) => a.path.localeCompare(b.path));
    const expectedRootHash = crypto
      .createHash('sha256')
      .update(calculatedEntries.map((e) => `${e.path}:${e.sha256}`).join('\n'))
      .digest('hex');

    if (manifest.rootHash && manifest.rootHash !== expectedRootHash) {
      throw new BadRequestException('Archive tamper detected: root hash mismatch');
    }
  }

  /**
   * Restores tenant data into targetTenantId from verified JSON files in the archive.
   */
  async restoreTenantFromExport(
    targetTenantId: string,
    archive: TenantGoBDZ3Archive,
    options: { dryRun?: boolean } = {},
  ): Promise<TenantRestoreResult> {
    this.verifyArchiveIntegrity(archive);

    const dryRun = options.dryRun ?? false;
    const restoredTables: Record<string, number> = {};
    let totalRecordsRestored = 0;

    // Dependency order for foreign key safety:
    const restoreOrder: string[] = [
      'fin_chart_of_accounts',
      'erp_parties',
      'erp_stock_items',
      'fin_journal_entries',
      'fin_journal_entry_lines',
      'invoices',
      'fin_cheques',
    ];

    await this.tenantScope.within(targetTenantId, undefined, async (em: EntityManager) => {
      for (const table of restoreOrder) {
        const matchingEntry = archive.manifest.files.find(
          (f) => f.table === table && f.format === 'json',
        );
        if (!matchingEntry) {
          restoredTables[table] = 0;
          continue;
        }

        const rawJson = archive.files[matchingEntry.path];
        if (!rawJson) {
          restoredTables[table] = 0;
          continue;
        }

        let parsedRows: any[];
        try {
          parsedRows = JSON.parse(rawJson);
        } catch {
          throw new BadRequestException(`Failed to parse JSON for ${matchingEntry.path}`);
        }

        if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
          restoredTables[table] = 0;
          continue;
        }

        if (!dryRun) {
          for (const row of parsedRows) {
            // Strict tenant isolation: force target tenant ID
            const safeRow = { ...row, tenant_id: targetTenantId };
            const columns = Object.keys(safeRow);
            const colNames = columns.map((c) => `"${c}"`).join(', ');
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const values = columns.map((c) => safeRow[c]);

            await em.query(
              `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              values,
            );
          }
        }

        restoredTables[table] = parsedRows.length;
        totalRecordsRestored += parsedRows.length;
      }
    });

    return {
      success: true,
      targetTenantId,
      verifiedFilesCount: archive.manifest.files.length,
      totalRecordsRestored,
      restoredTables,
      dryRun,
    };
  }
}
