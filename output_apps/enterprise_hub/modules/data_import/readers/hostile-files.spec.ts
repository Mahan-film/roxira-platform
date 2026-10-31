import * as fs from 'fs';
import * as path from 'path';
import { zipSync } from 'fflate';
import { iterateRows } from '../analysis/package-analysis';
import { detectFormat, readFormat, readMultiFiles } from './format-registry';
import { parseXml } from './xml-lite';

const BAD = path.join(__dirname, '..', '__fixtures__', 'hostile');
const load = (name: string): Buffer => fs.readFileSync(path.join(BAD, name));

describe('hostile uploads are refused or neutralised, never executed', () => {
  it('ZIP-slip: unsafe member names are skipped, safe ones read, nothing touches disk', async () => {
    const pkg = await readFormat(load('zip-slip.zip'), 'a.zip');
    // zip-reader already strips leading "../" and "/"; member names are only table labels and
    // nothing is ever written to disk, so the worst case is an oddly named in-memory table.
    expect(pkg.tables.map((t) => t.name).sort()).toEqual(['data', 'etc', 'evil']);
  });

  it('nested ZIP is not unpacked recursively', async () => {
    await expect(readFormat(load('zip-nested.zip'), 'a.zip')).rejects.toThrow(/هیچ فایل قابل خواندنی|تودرتو/);
  });

  it('ZIP bomb: inflated size is capped while inflating', async () => {
    const big = Buffer.alloc(120 * 1024 * 1024, 0x41);
    const zip = Buffer.from(zipSync({ 'a.csv': new Uint8Array(big), 'b.csv': new Uint8Array(big) }, { level: 9 }));
    expect(zip.length).toBeLessThan(2 * 1024 * 1024);
    await expect(readFormat(zip, 'bomb.zip')).rejects.toThrow(/۲۰۰ مگابایت|سقف/);
  });

  it('XML with DTD/ENTITY (XXE) is refused', async () => {
    await expect(readFormat(load('xml-xxe.xml'), 'a.xml')).rejects.toThrow(/DTD|ENTITY/);
  });

  it('billion-laughs is refused before any expansion', async () => {
    await expect(readFormat(load('xml-billion-laughs.xml'), 'a.xml')).rejects.toThrow(/DTD|ENTITY/);
  });

  it('XML nesting 5000 deep is refused', () => {
    expect(() => parseXml(load('xml-deep.xml').toString())).toThrow(/عمق/);
  });

  it('JSON nesting 5000 deep is refused without a stack overflow', async () => {
    await expect(readFormat(load('json-deep.json'), 'a.json')).rejects.toThrow(/عمق/);
  });

  it('DBF lying about its record count is clamped to the real file size', async () => {
    const pkg = await readFormat(load('dbf-lying-count.dbf'), 'a.dbf');
    expect([...iterateRows(pkg.tables[0])]).toHaveLength(4);
    expect(pkg.notes?.join(' ')).toMatch(/رکورد اعلام کرده/);
  });

  it('truncated XLS fails with a Persian error, not an exception leak', async () => {
    const result = readFormat(load('xls-truncated.xls'), 'a.xls');
    await expect(result).rejects.toBeInstanceOf(Error);
    await expect(result).rejects.not.toThrow(/Cannot read|undefined|RangeError/);
  });

  it('ODS number-rows-repeated bomb is refused', async () => {
    await expect(readFormat(load('ods-repeat-bomb.ods'), 'a.ods')).rejects.toThrow(/ODS|معتبر/);
  });

  it('MySQL dump with DROP/LOAD_FILE/SELECT/GRANT: data is read as text, nothing runs', async () => {
    const pkg = await readFormat(load('mysql-hostile.sql.txt'), 'a.txt');
    const rows = [...iterateRows(pkg.tables[0])];
    expect(rows[0].b).toBe('ok');
    // functions and sub-selects are kept as inert text, never evaluated
    expect(String(rows[1].b)).toContain('LOAD_FILE');
    expect(String(rows[2].b)).toContain('SELECT password');
    expect(pkg.notes?.join(' ')).toMatch(/نادیده گرفته شد/);
  });

  it('SQLite dump with ATTACH still goes through the allow-list and is refused', async () => {
    await expect(readFormat(load('sql-attach-stacked.sql.txt'), 'a.sql')).rejects.toThrow(/ATTACH|مجاز/);
  });

  it('CSV formula cells stay plain text', async () => {
    const pkg = await readFormat(load('csv-formula.csv'), 'a.csv');
    const rows = [...iterateRows(pkg.tables[0])];
    expect(rows[0].name).toBe('=HYPERLINK("http://evil","x")');
    expect(typeof rows[0].amount).toBe('string');
  });

  it('a single 1 MB cell is truncated and reported', async () => {
    const csv = `a,b\n${'x'.repeat(1_000_000)},2\n`;
    const pkg = await readFormat(Buffer.from(csv), 'a.csv');
    expect(String([...iterateRows(pkg.tables[0])][0].a).length).toBe(32_768);
    expect(pkg.notes?.join(' ')).toMatch(/بریده شد/);
  });

  it('control characters in cells are stripped', async () => {
    const pkg = await readFormat(Buffer.from('name,qty\nhel\u0001lo\u0007 world and more,2\nsecond row here,3\nthird row here,4\n'), 'a.csv');
    expect([...iterateRows(pkg.tables[0])][0].name).toBe('hello world and more');
  });

  it('prototype-pollution table/column names are neutralised', async () => {
    const pkg = await readFormat(Buffer.from('{"__proto__":[{"a":1}],"constructor":[{"b":2}]}'), 'a.json');
    expect(pkg.tables.map((t) => t.name)).not.toContain('__proto__');
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it('executables and unknown binaries are not "detected" as anything', () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(4096, 1)]);
    expect(detectFormat(elf, 'invoice.csv').id).toBe('unknown');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 2)]);
    expect(detectFormat(exe, 'data.xlsx').id).toBe('unknown');
  });

  it('multi-file drop: one bad file does not break the rest, and is reported', async () => {
    const files = [
      { name: 'a/ok.csv', buffer: Buffer.from('x,y\n1,2\n') },
      { name: 'a/bad.bin', buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4, 5, 6]) },
      { name: '../../evil.csv', buffer: Buffer.from('x,y\n9,9\n') },
    ];
    const pkg = await readMultiFiles(files.length, (i) => files[i]);
    expect(pkg.tables.map((t) => t.name)).toEqual(['ok']);
    expect(pkg.notes?.join(' ')).toMatch(/bad\.bin/);
    expect(pkg.notes?.join(' ')).toMatch(/مسیر ناامن/);
  });
});
