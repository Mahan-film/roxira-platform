import { strToU8, zipSync } from 'fflate';
import { OFFICIAL_ELECTRONIC_BOOKS_HEADERS } from './electronic-books.constants';

const escapeXml = (text: string): string =>
  text
    // XML 1.0 has no representation for these control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

/** Neutralise formula triggers (= + - @ TAB CR) in text cells. */
export function escapeFormula(text: string): string {
  const plainNumber = /^-?\d+(\.\d+)?$/.test(text);
  if (!plainNumber && /^[=+\-@\t\r]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);0"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="IRANSansWeb"/></font>
<font><b/><sz val="11"/><name val="IRANSansWeb"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

export type ElectronicBookRowValues = [
  kolCode: string,
  kolName: string,
  moeinCode: string,
  moeinName: string,
  tafsiliCode: string,
  tafsiliName: string,
  debitMillion: string | number,
  creditMillion: string | number,
  turnoverDate: string,
];

/**
 * Builds an official XLSX workbook matching `docs/tax/official/electronic-books-template.xlsx`.
 * One sheet (`Sheet1`), right-to-left, row 1 headers, rows 2..N account turnover records.
 */
export function writeElectronicBooksXlsx(rows: ElectronicBookRowValues[]): Buffer {
  const headerCells = OFFICIAL_ELECTRONIC_BOOKS_HEADERS.map(
    (h, idx) =>
      `<c r="${COLS[idx]}1" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(h)}</t></is></c>`,
  ).join('');

  const rowXmls: string[] = [`<row r="1" ht="20" customHeight="1">${headerCells}</row>`];

  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells: string[] = [];

    // Columns A-F: Account codes and titles (Text)
    for (let c = 0; c < 6; c++) {
      const val = escapeFormula(String(row[c] ?? ''));
      cells.push(
        `<c r="${COLS[c]}${r}" s="0" t="inlineStr"><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>`,
      );
    }

    // Column G: Debit turnover (Numeric million rials)
    const debitVal = String(row[6] ?? '0');
    const debitStyle = debitVal.includes('.') ? '3' : '2';
    cells.push(`<c r="G${r}" s="${debitStyle}"><v>${escapeXml(debitVal)}</v></c>`);

    // Column H: Credit turnover (Numeric million rials)
    const creditVal = String(row[7] ?? '0');
    const creditStyle = creditVal.includes('.') ? '3' : '2';
    cells.push(`<c r="H${r}" s="${creditStyle}"><v>${escapeXml(creditVal)}</v></c>`);

    // Column I: Date (Text YYYY/MM/DD)
    const dateVal = escapeFormula(String(row[8] ?? ''));
    cells.push(
      `<c r="I${r}" s="0" t="inlineStr"><is><t xml:space="preserve">${escapeXml(dateVal)}</t></is></c>`,
    );

    rowXmls.push(`<row r="${r}">${cells.join('')}</row>`);
  });

  const colsXml = `
<cols>
  <col min="1" max="1" width="15" customWidth="1"/>
  <col min="2" max="2" width="25" customWidth="1"/>
  <col min="3" max="3" width="15" customWidth="1"/>
  <col min="4" max="4" width="25" customWidth="1"/>
  <col min="5" max="5" width="18" customWidth="1"/>
  <col min="6" max="6" width="25" customWidth="1"/>
  <col min="7" max="7" width="24" customWidth="1"/>
  <col min="8" max="8" width="24" customWidth="1"/>
  <col min="9" max="9" width="18" customWidth="1"/>
</cols>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
  ${colsXml}
  <sheetData>${rowXmls.join('')}</sheetData>
</worksheet>`;

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
      'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml),
      'xl/styles.xml': strToU8(STYLES),
    }),
  );
}
