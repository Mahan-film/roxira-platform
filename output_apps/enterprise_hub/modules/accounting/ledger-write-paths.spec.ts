/**
 * Static guard for the single ledger write path.
 *
 * Every write to `fin_journal_entries` / `fin_journal_entry_lines` must go through
 * `AccountingRepository.persistJournalEntry` (or the repository's own helpers), so the period
 * lock of a closed fiscal year cannot be bypassed by a new module. The allowed files are listed
 * explicitly below: a new file that calls `persistJournalEntry` or writes the entry tables
 * directly fails this spec.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULES_DIR = path.join(__dirname, '..');

/** Callers of `persistJournalEntry` and the definition itself. */
const PERSIST_ALLOWED = new Set([
  'accounting/services/accounting.service.ts',
  'accounting/repositories/accounting.repository.ts',
]);

/** Raw or entity-level writes of the journal entry tables. */
const RAW_WRITE_ALLOWED = new Set([
  'accounting/repositories/accounting.repository.ts',
]);

const PATTERNS: Array<{ name: string; regex: RegExp; allowed: Set<string> }> = [
  { name: 'persistJournalEntry(', regex: /persistJournalEntry\s*\(/, allowed: PERSIST_ALLOWED },
  { name: 'INSERT INTO fin_journal_entries', regex: /INSERT\s+INTO\s+fin_journal_entries/i, allowed: RAW_WRITE_ALLOWED },
  { name: 'UPDATE fin_journal_entries', regex: /UPDATE\s+"?fin_journal_entries"?\b/i, allowed: RAW_WRITE_ALLOWED },
  { name: 'DELETE FROM fin_journal_entries', regex: /DELETE\s+FROM\s+"?fin_journal_entries"?\b/i, allowed: RAW_WRITE_ALLOWED },
  { name: '.into(JournalEntryEntity)', regex: /\.into\(\s*JournalEntryEntity\s*\)/, allowed: RAW_WRITE_ALLOWED },
  { name: '.update(JournalEntryEntity)', regex: /\.update\(\s*JournalEntryEntity\b/, allowed: RAW_WRITE_ALLOWED },
  { name: '.delete(JournalEntryEntity)', regex: /\.delete\(\s*JournalEntryEntity\b/, allowed: RAW_WRITE_ALLOWED },
  { name: 'INSERT INTO fin_journal_entry_lines', regex: /INSERT\s+INTO\s+fin_journal_entry_lines/i, allowed: RAW_WRITE_ALLOWED },
  { name: 'UPDATE fin_journal_entry_lines', regex: /UPDATE\s+"?fin_journal_entry_lines"?\b/i, allowed: RAW_WRITE_ALLOWED },
  { name: 'DELETE FROM fin_journal_entry_lines', regex: /DELETE\s+FROM\s+"?fin_journal_entry_lines"?\b/i, allowed: RAW_WRITE_ALLOWED },
  { name: '.into(JournalEntryLineEntity)', regex: /\.into\(\s*JournalEntryLineEntity\s*\)/, allowed: RAW_WRITE_ALLOWED },
  { name: '.update(JournalEntryLineEntity)', regex: /\.update\(\s*JournalEntryLineEntity\b/, allowed: RAW_WRITE_ALLOWED },
  { name: '.delete(JournalEntryLineEntity)', regex: /\.delete\(\s*JournalEntryLineEntity\b/, allowed: RAW_WRITE_ALLOWED },
  {
    name: 'EntityManager write on JournalEntry(Line)Entity',
    regex: /\.(?:save|insert|upsert|create)\s*\(\s*JournalEntry(?:Line)?Entity\b/,
    allowed: RAW_WRITE_ALLOWED,
  },
  {
    name: 'chained getRepository(JournalEntry(Line)Entity) write',
    regex: /\.getRepository\s*\(\s*JournalEntry(?:Line)?Entity\s*\)\s*\.\s*(?:save|insert|upsert|create|update|delete)\s*\(/,
    allowed: RAW_WRITE_ALLOWED,
  },
];

/**
 * Finds local variables or injected properties bound to a TypeORM repository for
 * `JournalEntryEntity` or `JournalEntryLineEntity` that invoke a write method
 * (`save`, `insert`, `upsert`, `create`, `update`, `delete`).
 */
const findRepoWriteOffenders = (source: string): string[] => {
  const hits: string[] = [];
  const varRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.getRepository\s*\(\s*JournalEntry(?:Line)?Entity\s*\)/g;
  const propRegex = /@InjectRepository\s*\(\s*JournalEntry(?:Line)?Entity\s*\)\s*(?:private|protected|public)?\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)/g;
  const names = new Set<string>();
  for (const m of source.matchAll(varRegex)) names.add(m[1]);
  for (const m of source.matchAll(propRegex)) names.add(m[1]);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const writeRe = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:save|insert|upsert|create|update|delete)\\s*\\(`);
    if (writeRe.test(source)) {
      hits.push(name);
    }
  }
  return hits;
};

/** Relative posix paths of every non-spec TypeScript file under modules/. */
const collectSourceFiles = (dir: string, base: string, acc: string[] = []): string[] => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      collectSourceFiles(full, base, acc);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      acc.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return acc;
};

describe('ledger write paths (static guard)', () => {
  const files = collectSourceFiles(MODULES_DIR, MODULES_DIR);

  it('scans the whole modules tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('accounting/repositories/accounting.repository.ts');
    expect(files).toContain('accounting/services/accounting.service.ts');
  });

  for (const { name, regex, allowed } of PATTERNS) {
    it(`keeps ${name} inside: ${[...allowed].join(' + ')}`, () => {
      const offenders = files
        .filter((file) => regex.test(fs.readFileSync(path.join(MODULES_DIR, file), 'utf8')))
        .filter((file) => !allowed.has(file));
      expect(offenders).toEqual([]);
    });
  }

  it(`keeps TypeORM repository writes to JournalEntry(Line)Entity inside: ${[...RAW_WRITE_ALLOWED].join(' + ')}`, () => {
    const offenders = files
      .filter((file) => !RAW_WRITE_ALLOWED.has(file))
      .filter((file) => findRepoWriteOffenders(fs.readFileSync(path.join(MODULES_DIR, file), 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
});
