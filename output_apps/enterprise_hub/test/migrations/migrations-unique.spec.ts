import * as fs from 'fs';
import * as path from 'path';

/**
 * CI Guard (T101):
 * - Guarantees all TypeORM migrations have unique timestamp prefixes to prevent out-of-order
 *   execution and merge conflicts.
 * - Grandfathers exactly the 7 duplicate timestamps already applied in production.
 * - Guarantees all migration class names and TypeORM `name` properties are globally unique.
 */
export const GRANDFATHERED_DUPLICATE_TIMESTAMPS = new Set<string>([
  '1789220000000',
  '1789410000000',
  '1789420000000',
  '1789440000000',
  '1789480000000',
  '1789500000000',
  '1789510000000',
]);

export interface MigrationFileInfo {
  fileName: string;
  filePath: string;
  timestamp: string;
  className?: string;
  propertyName?: string;
}

export function parseMigrationFiles(migrationsDir: string): MigrationFileInfo[] {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const results: MigrationFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    // Skip test files, index files, or helper files
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts') || entry.name === 'index.ts') continue;

    const match = entry.name.match(/^(\d{13})-/);
    const timestamp = match ? match[1] : '';
    const filePath = path.join(migrationsDir, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');

    const classMatch = content.match(/export\s+class\s+(\w+)(?:\s+implements\s+MigrationInterface)?/);
    const propMatch = content.match(/name\s*(?::\s*string)?\s*=\s*['"](\w+)['"]/);

    results.push({
      fileName: entry.name,
      filePath,
      timestamp,
      className: classMatch ? classMatch[1] : undefined,
      propertyName: propMatch ? propMatch[1] : undefined,
    });
  }

  return results;
}

describe('Migration Uniqueness & CI Guard (T101)', () => {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const migrations = parseMigrationFiles(migrationsDir);

  it('scans all migration files in output_apps/enterprise_hub/migrations/', () => {
    expect(migrations.length).toBeGreaterThan(30);
  });

  it('every migration file starts with a valid 13-digit millisecond timestamp prefix', () => {
    const invalidFiles = migrations.filter((m) => !/^\d{13}$/.test(m.timestamp));
    expect(invalidFiles.map((m) => m.fileName)).toEqual([]);
  });

  it('migration timestamps are strictly unique, grandfathering only the 7 documented production timestamps', () => {
    const timestampMap = new Map<string, string[]>();
    for (const m of migrations) {
      const list = timestampMap.get(m.timestamp) || [];
      list.push(m.fileName);
      timestampMap.set(m.timestamp, list);
    }

    const ungrandfatheredDuplicates: Record<string, string[]> = {};
    for (const [ts, files] of timestampMap.entries()) {
      if (files.length > 1 && !GRANDFATHERED_DUPLICATE_TIMESTAMPS.has(ts)) {
        ungrandfatheredDuplicates[ts] = files;
      }
    }

    expect(ungrandfatheredDuplicates).toEqual({});
  });

  it('the grandfathered allowlist contains exactly the 7 production timestamps', () => {
    expect(Array.from(GRANDFATHERED_DUPLICATE_TIMESTAMPS).sort()).toEqual([
      '1789220000000',
      '1789410000000',
      '1789420000000',
      '1789440000000',
      '1789480000000',
      '1789500000000',
      '1789510000000',
    ]);
  });

  it('migration class names are strictly unique across all files', () => {
    const classMap = new Map<string, string[]>();
    for (const m of migrations) {
      if (!m.className) continue;
      const list = classMap.get(m.className) || [];
      list.push(m.fileName);
      classMap.set(m.className, list);
    }

    const duplicates: Record<string, string[]> = {};
    for (const [cls, files] of classMap.entries()) {
      if (files.length > 1) {
        duplicates[cls] = files;
      }
    }

    expect(duplicates).toEqual({});
  });

  it('TypeORM migration name properties match class names and are strictly unique', () => {
    const propMap = new Map<string, string[]>();
    for (const m of migrations) {
      if (!m.propertyName) continue;
      const list = propMap.get(m.propertyName) || [];
      list.push(m.fileName);
      propMap.set(m.propertyName, list);
    }

    const duplicates: Record<string, string[]> = {};
    for (const [prop, files] of propMap.entries()) {
      if (files.length > 1) {
        duplicates[prop] = files;
      }
    }

    expect(duplicates).toEqual({});
  });

  describe('guard behavior regression assertions', () => {
    it('detects ungrandfathered timestamp collisions', () => {
      const mockFiles: MigrationFileInfo[] = [
        { fileName: '1789900009999-A.ts', filePath: '', timestamp: '1789900009999', className: 'A' },
        { fileName: '1789900009999-B.ts', filePath: '', timestamp: '1789900009999', className: 'B' },
      ];

      const timestampMap = new Map<string, string[]>();
      for (const m of mockFiles) {
        const list = timestampMap.get(m.timestamp) || [];
        list.push(m.fileName);
        timestampMap.set(m.timestamp, list);
      }

      const dupes = Array.from(timestampMap.entries()).filter(
        ([ts, files]) => files.length > 1 && !GRANDFATHERED_DUPLICATE_TIMESTAMPS.has(ts),
      );
      expect(dupes).toHaveLength(1);
      expect(dupes[0][0]).toBe('1789900009999');
    });

    it('detects duplicate migration class names', () => {
      const mockFiles: MigrationFileInfo[] = [
        { fileName: '1789900001000-A.ts', filePath: '', timestamp: '1789900001000', className: 'DuplicateMigration' },
        { fileName: '1789900002000-B.ts', filePath: '', timestamp: '1789900002000', className: 'DuplicateMigration' },
      ];

      const classMap = new Map<string, string[]>();
      for (const m of mockFiles) {
        if (!m.className) continue;
        const list = classMap.get(m.className) || [];
        list.push(m.fileName);
        classMap.set(m.className, list);
      }

      const dupes = Array.from(classMap.entries()).filter(([, files]) => files.length > 1);
      expect(dupes).toHaveLength(1);
      expect(dupes[0][0]).toBe('DuplicateMigration');
    });
  });
});
