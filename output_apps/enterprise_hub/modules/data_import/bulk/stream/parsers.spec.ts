import { zipSync, strToU8 } from 'fflate';
import { Readable } from 'stream';
import { parseSource } from './source-parser';
import { CsvStreamParser } from './csv-parser';
import { SqlStreamParser } from './sql-parser';
import { Cell, ParseEvent, PushParser } from './types';

/** Collects tables -> {columns, rows} from events. */
function collect(events: Iterable<ParseEvent>, into: Record<string, { columns: string[]; rows: Cell[][] }> = {}, notes: string[] = []) {
  for (const event of events) {
    if (event.kind === 'table') into[event.table] = { columns: event.columns, rows: [] };
    else if (event.kind === 'rows') into[event.table].rows.push(...event.rows);
    else notes.push(event.message);
  }
  return { tables: into, notes };
}

function runChunked(make: () => PushParser, bytes: Buffer, sizes: number[]) {
  const parser = make();
  const tables: Record<string, { columns: string[]; rows: Cell[][] }> = {};
  const notes: string[] = [];
  let at = 0;
  let k = 0;
  while (at < bytes.length) {
    const size = sizes[k % sizes.length];
    collect(parser.push(bytes.subarray(at, at + size)), tables, notes);
    at += size;
    k += 1;
  }
  collect(parser.end(), tables, notes);
  return { tables, notes };
}

const CSV = Buffer.from(
  'id,name,note\r\n1,"Ali, Reza","line1\nline2"\r\n2,"say ""hi""",plain\r\n3,,=SUM(A1)\r\n\r\n4,علی,\u0000x\r\n5,last,end',
  'utf8',
);

describe('CsvStreamParser', () => {
  it('parses quotes, embedded newlines, blank lines and a final row without newline', () => {
    const { tables } = runChunked(() => new CsvStreamParser('t'), CSV, [100000]);
    expect(tables.t.columns).toEqual(['id', 'name', 'note']);
    expect(tables.t.rows.map((r) => r[1])).toEqual(['Ali, Reza', 'say "hi"', '', 'علی', 'last']);
    expect(tables.t.rows[0][2]).toBe('line1\nline2');
    expect(tables.t.rows[4]).toEqual(['5', 'last', 'end']);
  });

  it('gives identical output for every chunk size (boundary fuzz)', () => {
    const whole = runChunked(() => new CsvStreamParser('t'), CSV, [100000]).tables;
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      expect(runChunked(() => new CsvStreamParser('t'), CSV, [size]).tables).toEqual(whole);
    }
  });

  it('counts formula-like cells and detects semicolon and tab delimiters', () => {
    const { tables, notes } = runChunked(() => new CsvStreamParser('t'), Buffer.from('a;b\n=1+1;x\n', 'utf8'), [4]);
    expect(tables.t.columns).toEqual(['a', 'b']);
    expect(notes.join(' ')).toContain('فرمول');
    const tsv = runChunked(() => new CsvStreamParser('t'), Buffer.from('a\tb\n1\t2\n'), [3]);
    expect(tsv.tables.t.rows).toEqual([['1', '2']]);
  });

  it('reads UTF-16LE and Windows-1256', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n۱,علی\n', 'utf16le')]);
    expect(runChunked(() => new CsvStreamParser('t'), utf16, [5]).tables.t.rows).toEqual([['۱', 'علی']]);
    const cp1256 = Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xe1, 0xe1, 0x2c, 0xc7, 0x0a]); // "لل","ا" in cp1256
    const out = runChunked(() => new CsvStreamParser('t'), cp1256, [100]);
    expect(out.tables.t.rows[0][0]).toBe('لل');
  });

  it('stops a runaway quote instead of swallowing the file', () => {
    const hostile = Buffer.from('a,b\n1,"' + 'x'.repeat(5 * 1024 * 1024), 'utf8');
    expect(() => runChunked(() => new CsvStreamParser('t'), hostile, [1024 * 1024])).toThrow(/CSV/);
  });

  it('truncates oversized cells and ignores columns beyond the cap', () => {
    const big = 'x'.repeat(40_000);
    const wide = Array.from({ length: 600 }, (_, i) => `c${i}`).join(',');
    const { tables, notes } = runChunked(() => new CsvStreamParser('t'), Buffer.from(`a,b\n${big},1\n${wide}\n`), [9999]);
    expect(tables.t.rows[0][0]?.length).toBe(32768);
    expect(tables.t.rows[1].length).toBe(512);
    expect(notes.join(' ')).toContain('بریده');
  });
});

const MYSQL = Buffer.from(
  [
    '-- MySQL dump 10.13',
    '/*!40101 SET NAMES utf8 */;',
    "CREATE TABLE `people` (`id` int NOT NULL, `name` varchar(20), `bio` text, PRIMARY KEY (`id`)) ENGINE=InnoDB;",
    "LOCK TABLES `people` WRITE;",
    "INSERT INTO `people` VALUES (1,'Ali',NULL),(2,'O\\'Neil; x','a\\nb'),(3,'it''s',N'wide'),(4,'x',0x41);",
    "INSERT INTO `people` (`id`,`name`) VALUES (5,'five');",
    'UNLOCK TABLES;',
    "-- a comment with ; and 'quote",
    "INSERT INTO `other` (a,b) VALUES (CAST('2020-01-01' AS date), 'y');",
  ].join('\n'),
  'utf8',
);

describe('SqlStreamParser', () => {
  it('reads MySQL INSERTs without executing, using CREATE TABLE columns', () => {
    const { tables } = runChunked(() => new SqlStreamParser('dump'), MYSQL, [1000000]);
    expect(tables.people.columns).toEqual(['id', 'name', 'bio']);
    expect(tables.people.rows).toEqual([
      ['1', 'Ali', null],
      ['2', "O'Neil; x", 'a\nb'],
      ['3', "it's", 'wide'],
      ['4', 'x', '0x41'],
      ['5', 'five'],
    ]);
    expect(tables.other.rows[0][0]).toBe("CAST('2020-01-01' AS date)");
  });

  it('gives identical output for every chunk size (boundary fuzz)', () => {
    const whole = runChunked(() => new SqlStreamParser('dump'), MYSQL, [1000000]).tables;
    for (const size of [1, 2, 3, 5, 7, 13, 64, 100]) {
      expect(runChunked(() => new SqlStreamParser('dump'), MYSQL, [size]).tables).toEqual(whole);
    }
  });

  it('reads PostgreSQL COPY blocks and INSERT with quoted identifiers', () => {
    const pg = Buffer.from(
      [
        '-- PostgreSQL database dump',
        'CREATE TABLE public.items (id integer, title text);',
        'COPY public.items (id, title) FROM stdin;',
        '1\tfoo\\tbar',
        '2\t\\N',
        '\\.',
        'INSERT INTO "public"."items" ("id","title") VALUES (3, \'c:\\path\');',
      ].join('\n'),
    );
    for (const size of [1000, 3, 7]) {
      const { tables } = runChunked(() => new SqlStreamParser('d'), pg, [size]);
      expect(tables.items.columns).toEqual(['id', 'title']);
      expect(tables.items.rows).toEqual([
        ['1', 'foo\tbar'],
        ['2', null],
        ['3', 'c:\\path'],
      ]);
    }
  });

  it('reads T-SQL scripts that end statements with GO', () => {
    const tsql = Buffer.from(
      [
        'SET ANSI_NULLS ON',
        'GO',
        "INSERT [dbo].[T] ([a],[b]) VALUES (1, N'x')",
        'GO',
        "INSERT [dbo].[T] ([a],[b]) VALUES (2, N'y; z')",
        'GO',
      ].join('\r\n'),
    );
    const { tables } = runChunked(() => new SqlStreamParser('d'), tsql, [6]);
    expect(tables.T.columns).toEqual(['a', 'b']);
    expect(tables.T.rows).toEqual([
      ['1', 'x'],
      ['2', 'y; z'],
    ]);
  });

  it('never runs anything: ATTACH and stacked statements are counted as skipped', () => {
    const sql = Buffer.from("ATTACH DATABASE '/etc/passwd' AS x;\nDROP TABLE users;\nINSERT INTO t (a) VALUES (1);\n");
    const { tables, notes } = runChunked(() => new SqlStreamParser('d'), sql, [10]);
    expect(tables.t.rows).toEqual([['1']]);
    expect(notes.join(' ')).toContain('هیچ دستوری اجرا نمی‌شود');
  });
});

async function drain(gen: AsyncGenerator<ParseEvent>) {
  const tables: Record<string, { columns: string[]; rows: Cell[][] }> = {};
  const notes: string[] = [];
  for await (const event of gen) collect([event], tables, notes);
  return { tables, notes };
}

const src = (bytes: Uint8Array, fileName: string) => ({
  fileName,
  size: bytes.length,
  legacyMaxBytes: 1024 * 1024,
  open: async () => Readable.from([Buffer.from(bytes)]),
});

describe('parseSource', () => {
  it('reads a ZIP folder of CSV and SQL files and notes what it skipped', async () => {
    const zip = zipSync({
      'sales/jan.csv': strToU8('id,amount\n1,10\n2,20\n'),
      'dump.sql': strToU8("INSERT INTO t (a) VALUES (1),(2);"),
      'logo.png': strToU8('not an image'),
    });
    const { tables, notes } = await drain(parseSource(src(zip, 'folder.zip')));
    expect(Object.keys(tables).sort()).toEqual(['dump', 't', 'sales/jan'].sort().filter((k) => k !== 'dump'));
    expect(tables['sales/jan'].rows).toEqual([['1', '10'], ['2', '20']]);
    expect(notes.join(' ')).toContain('logo.png');
  });

  it('rejects zip-slip paths and nested archives', async () => {
    const slip = zipSync({ '../evil.csv': strToU8('a\n1\n') });
    await expect(drain(parseSource(src(slip, 'x.zip')))).rejects.toThrow(/مسیر ناامن/);
    const nested = zipSync({ 'inner.zip': zipSync({ 'a.csv': strToU8('a\n1\n') }), 'ok.csv': strToU8('a\n1\n') });
    const { notes, tables } = await drain(parseSource(src(nested, 'x.zip')));
    expect(tables.ok.rows).toEqual([['1']]);
    expect(notes.join(' ')).toContain('تودرتو');
  });

  it('reads an XLSX with shared strings, inline strings, dates and hidden sheets', async () => {
    const files = {
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Main" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>when</t></is></c></row>' +
          '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" s="1"><v>45000</v></c></row>' +
          '<row r="3"><c r="B3" t="s"><v>3</v></c></row>' +
          '</sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row><c t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>id</t></si><si><t>name</t></si><si><r><t>Al</t></r><r><t>i &amp; co</t></r></si><si><t>ي</t><rPh><t>PHON</t></rPh></si></sst>'),
      'xl/styles.xml': strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    };
    const zip = zipSync(files);
    const { tables, notes } = await drain(parseSource(src(zip, 'book.xlsx')));
    expect(tables.Main.columns).toEqual(['id', 'name', 'when']);
    expect(tables.Main.rows).toEqual([
      ['42', 'Ali & co', '2023-03-15'],
      ['', 'ي'],
    ]);
    expect(tables.Secret).toBeUndefined();
    expect(notes.join(' ')).toContain('پنهان');
  });

  it('refuses DTD/ENTITY inside XLSX parts', async () => {
    const zip = zipSync({
      'xl/workbook.xml': strToU8('<!DOCTYPE x [<!ENTITY a "b">]><workbook/>'),
    });
    await expect(drain(parseSource(src(zip, 'x.xlsx')))).rejects.toThrow(/DTD/);
  });

  it('falls back to the legacy readers for small JSON and refuses oversize legacy files', async () => {
    const json = Buffer.from(JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]));
    const { tables } = await drain(parseSource(src(json, 'rows.json')));
    expect(Object.values(tables)[0].rows).toEqual([['1', 'x'], ['2', 'y']]);
    await expect(drain(parseSource({ ...src(json, 'rows.json'), legacyMaxBytes: 4 }))).rejects.toThrow(/مگابایت/);
  });
});
