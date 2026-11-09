import { unzipSync } from 'fflate';
import { escapeFormula, writeXlsx } from './xlsx-writer';
import { ReportTable } from './report-table';

describe('xlsx-writer formula-injection prevention (CWE-1236 / T33)', () => {
  describe('escapeFormula', () => {
    it('escapes cells starting with formula triggers = + - @ \\t \\r', () => {
      expect(escapeFormula('=CMD|\' /C calc\'!A0')).toBe('\'=CMD|\' /C calc\'!A0');
      expect(escapeFormula('+SUM(1,2)')).toBe('\'+SUM(1,2)');
      expect(escapeFormula('-2+3')).toBe('\'-2+3');
      expect(escapeFormula('@SUM(A1:A10)')).toBe('\'@SUM(A1:A10)');
      expect(escapeFormula('\t=1+1')).toBe('\'\t=1+1');
      expect(escapeFormula('\r+cmd')).toBe('\'\r+cmd');
    });

    it('preserves plain signed numbers without prepending apostrophe', () => {
      expect(escapeFormula('-100')).toBe('-100');
      expect(escapeFormula('-1250.75')).toBe('-1250.75');
      expect(escapeFormula('100')).toBe('100');
      expect(escapeFormula('0')).toBe('0');
    });

    it('preserves normal alphanumeric and Persian text', () => {
      expect(escapeFormula('حسابداری')).toBe('حسابداری');
      expect(escapeFormula('Asset - Cash')).toBe('Asset - Cash');
      expect(escapeFormula('Item #123')).toBe('Item #123');
    });
  });

  describe('writeXlsx', () => {
    it('neutralises formula injection in titles, headers, and cell values', () => {
      const table: ReportTable = {
        title: '=HYPERLINK("http://evil.com","Title")',
        subtitle: '@EVIL_SUBTITLE',
        columns: [
          { title: '+HEADER_INJECTION', width: 2 },
          { title: 'عادی', money: true },
        ],
        rows: [
          {
            cells: ['=CMD|\' /C calc\'!A0', 100000n],
          },
          {
            cells: ['-2+5', -50000n],
          },
          {
            cells: ['@SUM(1,2)', 0n],
          },
        ],
      };

      const buffer = writeXlsx(table);
      expect(buffer).toBeInstanceOf(Buffer);

      // Unzip and inspect sheet1.xml
      const unzipped = unzipSync(new Uint8Array(buffer));
      const sheetXml = Buffer.from(unzipped['xl/worksheets/sheet1.xml']).toString('utf8');

      // Formula characters must be escaped with a leading apostrophe
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)=HYPERLINK/);
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)@EVIL_SUBTITLE/);
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)\+HEADER_INJECTION/);
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)=CMD/);
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)-2\+5/);
      expect(sheetXml).toMatch(/('|\&apos;|&#39;)@SUM/);

      // Plain numeric values must stay numeric
      expect(sheetXml).toContain('<v>1000.00</v>');
      expect(sheetXml).toContain('<v>-500.00</v>');
      expect(sheetXml).toContain('<v>0.00</v>');
    });
  });
});
