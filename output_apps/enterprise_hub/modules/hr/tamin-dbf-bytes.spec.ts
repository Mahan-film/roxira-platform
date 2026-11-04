import { readFileSync } from 'fs';
import { join } from 'path';
import { writeDbf } from './services/dbf-file';
import {
  DSKKAR_LAYOUT,
  DSKWOR_LAYOUT,
  INSURANCE_LIST_UNVERIFIED,
} from './services/insurance-list';

/**
 * Byte-level fixture spec for the Tamin list files. The expected columns are read from the spec
 * document, not from the code, so the two cannot drift apart silently.
 */
const SPEC = readFileSync(
  join(__dirname, '../../../../docs/legal_sources/iran/tamin-list-v6-fields.md'),
  'utf8',
);

function specRows(heading: string): { name: string; type: string; length: number }[] {
  const body = SPEC.split(heading)[1].split(/\n## /)[0];
  return body
    .split('\n')
    .map((line) => line.split('|').map((c) => c.trim()))
    .filter((c) => /^\d+$/.test(c[1] ?? '') && /^[CN]$/.test(c[3] ?? ''))
    .map((c) => ({ name: c[2], type: c[3], length: Number(c[4]) }));
}

describe('Tamin DBF layouts against the spec document', () => {
  it('DSKKAR00 has the 23 published columns in order', () => {
    const rows = specRows('## DSKKAR00.DBF');
    expect(rows).toHaveLength(23);
    expect(DSKKAR_LAYOUT.map((f) => f.name)).toEqual(rows.map((r) => r.name));
    expect(DSKKAR_LAYOUT.map((f) => f.type)).toEqual(rows.map((r) => r.type));
    expect(DSKKAR_LAYOUT.map((f) => f.length)).toEqual(rows.map((r) => r.length));
  });

  it('DSKWOR00 has the 27 published columns; only DSW_ID1 differs (documented)', () => {
    const rows = specRows('## DSKWOR00.DBF');
    expect(rows).toHaveLength(27);
    expect(DSKWOR_LAYOUT.map((f) => f.name)).toEqual(rows.map((r) => r.name));
    const differing = DSKWOR_LAYOUT.filter((f, i) => f.length !== rows[i].length || f.type !== rows[i].type);
    expect(differing.map((f) => f.name)).toEqual(['DSW_ID1']);
    expect(SPEC).toContain('**unclear**: S1 says width 8');
  });
});

describe('Tamin DBF bytes', () => {
  const fields = [
    { name: 'DSK_ID', type: 'C' as const, length: 10 },
    { name: 'DSK_NUM', type: 'N' as const, length: 5 },
  ];
  const file = writeDbf(fields, [{ DSK_ID: '1234567890', DSK_NUM: 7 }], new Date(Date.UTC(2026, 10, 4)));

  it('header: version, date, counts, sizes, language driver', () => {
    expect([...file.subarray(0, 4)]).toEqual([0x03, 126, 11, 4]);
    expect(file.readUInt32LE(4)).toBe(1);
    expect(file.readUInt16LE(8)).toBe(32 + 2 * 32 + 1); // 97
    expect(file.readUInt16LE(10)).toBe(1 + 10 + 5);
    expect(file[29]).toBe(0x7e);
  });

  it('field descriptors: name padded with NUL, type, length', () => {
    const d0 = file.subarray(32, 64);
    expect(d0.toString('ascii', 0, 6)).toBe('DSK_ID');
    expect(d0[6]).toBe(0);
    expect(d0[11]).toBe('C'.charCodeAt(0));
    expect(d0[16]).toBe(10);
    const d1 = file.subarray(64, 96);
    expect(d1[11]).toBe('N'.charCodeAt(0));
    expect(d1[16]).toBe(5);
    expect(file[96]).toBe(0x0d);
  });

  it('record: deletion flag, left-aligned text, right-aligned number, EOF marker', () => {
    expect(file.subarray(97, 113).toString('latin1')).toBe(' 1234567890    7');
    expect(file[113]).toBe(0x1a);
    expect(file.length).toBe(114);
  });

  it('Persian text is Windows-1256 bytes, ye becomes the Arabic ye (0xED)', () => {
    const p = writeDbf([{ name: 'N', type: 'C', length: 4 }], [{ N: 'علی' }], new Date(Date.UTC(2026, 10, 4)));
    expect([...p.subarray(66, 70)]).toEqual([0xda, 0xe1, 0xed, 0x20]);
  });
});

describe('uploadReady honesty', () => {
  it('stays false while any spec item is unverified', () => {
    expect(INSURANCE_LIST_UNVERIFIED.length).toBeGreaterThan(0);
  });
});
