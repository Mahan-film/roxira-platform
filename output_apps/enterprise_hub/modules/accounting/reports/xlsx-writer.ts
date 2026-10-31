import { strToU8, zipSync } from 'fflate';
import { minorToDecimal } from '../money';
import { ReportCell, ReportTable } from './report-table';

const escapeXml = (text: string): string =>
  text
    // XML 1.0 has no representation for these control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const columnName = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
};

/** Style ids of styles.xml. */
const STYLE = { text: 0, bold: 1, money: 2, moneyBold: 3, moneyFraction: 4, moneyFractionBold: 5, title: 6 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0;(#,##0);0"/><numFmt numFmtId="165" formatCode="#,##0.00;(#,##0.00);0"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="14"/><name val="Tahoma"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

function cellXml(cell: ReportCell, reference: string, bold: boolean, titleStyle = false): string {
  if (cell === null || cell === '') {
    return '';
  }
  if (typeof cell === 'bigint') {
    const fraction = cell % 100n !== 0n;
    const style = fraction
      ? bold ? STYLE.moneyFractionBold : STYLE.moneyFraction
      : bold ? STYLE.moneyBold : STYLE.money;
    return `<c r="${reference}" s="${style}"><v>${minorToDecimal(cell)}</v></c>`;
  }
  // Inline strings are never evaluated, so account names cannot act as spreadsheet formulas.
  const style = titleStyle ? STYLE.title : bold ? STYLE.bold : STYLE.text;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
}

/** A one-sheet right-to-left workbook. */
export function writeXlsx(table: ReportTable): Buffer {
  const rows: Array<{ cells: ReportCell[]; bold?: boolean; title?: boolean }> = [
    { cells: [table.title], title: true },
    { cells: [table.subtitle] },
    { cells: [] },
    { cells: table.columns.map((column) => column.title), bold: true },
    ...table.rows,
  ];
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row.cells
        .map((cell, index) =>
          cellXml(cell, `${columnName(index)}${rowIndex + 1}`, Boolean(row.bold), Boolean(row.title)),
        )
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const widths = table.columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.money ? 20 : Math.max(14, (column.width ?? 1) * 14)}" customWidth="1"/>`)
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const sheetName = escapeXml(table.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      'xl/styles.xml': strToU8(STYLES),
    }),
  );
}
