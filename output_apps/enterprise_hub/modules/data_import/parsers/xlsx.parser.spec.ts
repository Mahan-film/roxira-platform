import { deflateRawSync } from 'zlib';
import { parseXlsx, XlsxParseError } from './xlsx.parser';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

interface ZipFile {
  name: string;
  data: Buffer;
}

/** جدول CRC-32 برای ساخت آرشیو ZIP معتبر در تست. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ساخت کمینه یک آرشیو ZIP (deflate) شامل هدر محلی، فهرست مرکزی و EOCD؛
 * دقیقاً همان ساختاری که `parseXlsx` می‌خواند.
 */
function makeZip(files: ZipFile[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data);
    const utf8Flag = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

/** ساخت XML برگه از ردیف‌های داده‌شده. */
function sheetXml(rows: string): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`,
    'utf8',
  );
}

describe('parseXlsx', () => {
  it('reads shared strings, numbers and keeps empty cell positions', () => {
    const sharedStrings = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}" count="2" uniqueCount="2">` +
        '<si><t>full name</t></si>' +
        '<si><r><t>e</t></r><r><t>mail</t></r></si>' +
        '</sst>',
      'utf8',
    );
    const sheet = sheetXml(
      '<row r="1">' +
        '<c r="A1" t="s"><v>0</v></c>' +
        '<c r="C1" t="s"><v>1</v></c>' +
        '</row>' +
        '<row r="2">' +
        '<c r="A2" t="s"><v>1</v></c>' +
        '<c r="B2"><v>42</v></c>' +
        '<c r="C2"><v>7.5</v></c>' +
        '</row>',
    );

    const parsed = parseXlsx(
      makeZip([
        { name: 'xl/worksheets/sheet1.xml', data: sheet },
        { name: 'xl/sharedStrings.xml', data: sharedStrings },
      ]),
    );

    expect(parsed.headers).toEqual(['full name', '', 'email']);
    expect(parsed.rows).toEqual([['email', '42', '7.5']]);
  });

  it('reads inline strings, numbers and booleans', () => {
    const sheet = sheetXml(
      '<row r="1">' +
        '<c r="A1" t="inlineStr"><is><t>full name</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t>active</t></is></c>' +
        '</row>' +
        '<row r="2">' +
        '<c r="A2" t="inlineStr"><is><t>Sara</t></is></c>' +
        '<c r="B2" t="b"><v>1</v></c>' +
        '</row>' +
        '<row r="3">' +
        '<c r="A3"><v>3.14</v></c>' +
        '<c r="B3" t="inlineStr"><is><t>ok</t></is></c>' +
        '</row>',
    );

    const parsed = parseXlsx(
      makeZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }]),
    );

    expect(parsed.headers).toEqual(['full name', 'active']);
    expect(parsed.rows).toEqual([
      ['Sara', 'true'],
      ['3.14', 'ok'],
    ]);
  });

  it('maps multi-letter columns (AA) without shifting earlier cells', () => {
    const sheet = sheetXml(
      '<row r="1">' +
        '<c r="A1" t="inlineStr"><is><t>first</t></is></c>' +
        '<c r="AA1" t="inlineStr"><is><t>last</t></is></c>' +
        '</row>' +
        '<row r="2">' +
        '<c r="A2" t="inlineStr"><is><t>x</t></is></c>' +
        '<c r="AA2" t="inlineStr"><is><t>y</t></is></c>' +
        '</row>',
    );

    const parsed = parseXlsx(
      makeZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }]),
    );

    expect(parsed.headers).toHaveLength(27);
    expect(parsed.headers[0]).toBe('first');
    expect(parsed.headers[26]).toBe('last');
    expect(parsed.headers.slice(1, 26)).toEqual(Array(25).fill(''));
    expect(parsed.rows[0]).toHaveLength(27);
    expect(parsed.rows[0][0]).toBe('x');
    expect(parsed.rows[0][26]).toBe('y');
  });

  it('resolves the first sheet through workbook.xml and rels', () => {
    const workbook = Buffer.from(
      `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        '<sheets><sheet name="Third" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>',
      'utf8',
    );
    const rels = Buffer.from(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
        '</Relationships>',
      'utf8',
    );

    const parsed = parseXlsx(
      makeZip([
        { name: 'xl/workbook.xml', data: workbook },
        { name: 'xl/_rels/workbook.xml.rels', data: rels },
        {
          name: 'xl/worksheets/sheet3.xml',
          data: sheetXml(
            '<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row>' +
              '<row r="2"><c r="A2" t="inlineStr"><is><t>Sara</t></is></c></row>',
          ),
        },
      ]),
    );

    expect(parsed.headers).toEqual(['name']);
    expect(parsed.rows).toEqual([['Sara']]);
  });

  it('rejects a non-ZIP file with a Persian error', () => {
    expect(() => parseXlsx(Buffer.from('not a zip at all', 'utf8'))).toThrow(
      XlsxParseError,
    );
  });

  it('rejects a ZIP that is not a spreadsheet', () => {
    const zip = makeZip([
      { name: 'word/document.xml', data: Buffer.from('<doc/>', 'utf8') },
    ]);
    expect(() => parseXlsx(zip)).toThrow(XlsxParseError);
  });

  it('rejects an XLSX larger than the configured sheet limit', () => {
    process.env.IMPORT_MAX_SHEET_BYTES = '16';
    try {
      const sheet = sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Sara</t></is></c></row>',
      );
      const zip = makeZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet }]);
      expect(() => parseXlsx(zip)).toThrow(XlsxParseError);
    } finally {
      delete process.env.IMPORT_MAX_SHEET_BYTES;
    }
  });
});
