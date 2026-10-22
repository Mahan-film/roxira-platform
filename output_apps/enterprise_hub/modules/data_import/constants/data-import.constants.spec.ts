import 'reflect-metadata';
import {
  DEFAULT_DAILY_IMPORT_FILES,
  DEFAULT_MAX_DOC_BYTES,
  DEFAULT_MAX_IMPORT_ROWS,
  DEFAULT_MAX_SHEET_BYTES,
  dailyImportFileLimit,
  maxBytesForKind,
  maxDocBytes,
  maxImportRows,
  maxSheetBytes,
  maxUploadBytes,
} from './data-import.constants';

const ENV_KEYS = [
  'IMPORT_MAX_SHEET_BYTES',
  'IMPORT_MAX_DOC_BYTES',
  'IMPORT_MAX_ROWS',
  'IMPORT_DAILY_FILES',
] as const;

describe('data-import constants', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it('exposes the requested defaults', () => {
    expect(maxSheetBytes()).toBe(10 * 1024 * 1024);
    expect(maxDocBytes()).toBe(15 * 1024 * 1024);
    expect(maxImportRows()).toBe(20000);
    expect(dailyImportFileLimit()).toBe(20);
    expect(maxUploadBytes()).toBe(Math.max(10, 15) * 1024 * 1024);
    expect(DEFAULT_MAX_SHEET_BYTES).toBe(10 * 1024 * 1024);
    expect(DEFAULT_MAX_DOC_BYTES).toBe(15 * 1024 * 1024);
    expect(DEFAULT_MAX_IMPORT_ROWS).toBe(20000);
    expect(DEFAULT_DAILY_IMPORT_FILES).toBe(20);
  });

  it('reads limits from the environment', () => {
    process.env.IMPORT_MAX_SHEET_BYTES = '1234';
    process.env.IMPORT_MAX_DOC_BYTES = '5678';
    process.env.IMPORT_MAX_ROWS = '99';
    process.env.IMPORT_DAILY_FILES = '7';

    expect(maxSheetBytes()).toBe(1234);
    expect(maxDocBytes()).toBe(5678);
    expect(maxImportRows()).toBe(99);
    expect(dailyImportFileLimit()).toBe(7);
    expect(maxUploadBytes()).toBe(5678);
  });

  it('ignores invalid environment values and keeps the default', () => {
    process.env.IMPORT_MAX_SHEET_BYTES = 'not-a-number';
    process.env.IMPORT_MAX_ROWS = '0';
    expect(maxSheetBytes()).toBe(DEFAULT_MAX_SHEET_BYTES);
    expect(maxImportRows()).toBe(DEFAULT_MAX_IMPORT_ROWS);
  });

  it('maps file kinds to their size limits', () => {
    process.env.IMPORT_MAX_SHEET_BYTES = '100';
    process.env.IMPORT_MAX_DOC_BYTES = '200';
    expect(maxBytesForKind('csv')).toBe(100);
    expect(maxBytesForKind('xlsx')).toBe(100);
    expect(maxBytesForKind('pdf')).toBe(200);
    expect(maxBytesForKind('image')).toBe(200);
    expect(maxBytesForKind('unknown')).toBe(200);
  });
});
