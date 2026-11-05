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
  { name: '.into(JournalEntryEntity)', regex: /\.into\(JournalEntryEntity\)/, allowed: RAW_WRITE_ALLOWED },
  { name: 'INSERT INTO fin_journal_entry_lines', regex: /INSERT\s+INTO\s+fin_journal_entry_lines/i, allowed: RAW_WRITE_ALLOWED },
  { name: '.into(JournalEntryLineEntity)', regex: /\.into\(JournalEntryLineEntity\)/, allowed: RAW_WRITE_ALLOWED },
];

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
});
