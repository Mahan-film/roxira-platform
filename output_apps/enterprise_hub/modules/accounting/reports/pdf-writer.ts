import * as path from 'path';
import PDFDocument from 'pdfkit';
import { minorToDecimal } from '../money';
import { ReportCell, ReportTable } from './report-table';

const fontDirectory = (): string =>
  path.join(path.dirname(require.resolve('vazirmatn/package.json')), 'fonts/ttf');

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toPersianDigits = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);

/** "(۱٬۲۳۴٫۵۰)" for a negative amount. Amounts stay exact: this formats the decimal string. */
export function formatMoney(minor: bigint): string {
  const decimal = minorToDecimal(minor < 0n ? -minor : minor);
  const [integer, fraction] = decimal.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  const text = toPersianDigits(fraction === '00' ? grouped : `${grouped}٫${fraction}`);
  return minor < 0n ? `(${text})` : text;
}

/** Runs that read left to right inside Persian text: numbers, dates, Latin codes. */
const LTR_RUN = /[0-9A-Za-z۰-۹][0-9A-Za-z۰-۹٬٫,._:/-]*/g;

/** Logical order runs of a cell. pdfkit lays out each run on its own, without a bidi algorithm. */
function runs(text: string): Array<{ text: string; ltr: boolean }> {
  const result: Array<{ text: string; ltr: boolean }> = [];
  let position = 0;
  for (const match of text.matchAll(LTR_RUN)) {
    if (match.index > position) {
      result.push({ text: text.slice(position, match.index), ltr: false });
    }
    result.push({ text: match[0], ltr: true });
    position = match.index + match[0].length;
  }
  if (position < text.length) {
    result.push({ text: text.slice(position), ltr: false });
  }
  return result;
}

/**
 * Passing `features` makes pdfkit shape the whole run at once. Without it pdfkit lays out each word
 * alone and left to right, which reverses the word order of Persian text.
 */
const WHOLE_RUN = { features: [], lineBreak: false } as PDFKit.Mixins.TextOptions;

/** The shaper treats Persian digits as right-to-left text; reversing a number cancels that. */
const shaped = (run: { text: string; ltr: boolean }): string => {
  if (!run.ltr) {
    // The shaper does not mirror brackets in right-to-left runs.
    return run.text.replace(/[()]/g, (bracket) => (bracket === '(' ? ')' : '('));
  }
  return /[۰-۹]/.test(run.text) && !/[A-Za-z]/.test(run.text)
    ? [...run.text].reverse().join('')
    : run.text;
};

const MARGIN = 28;
const ROW_HEIGHT = 18;

/** Draws `text` right-aligned, so that it ends at `right`, running right to left. */
function drawRtl(doc: PDFKit.PDFDocument, text: string, right: number, y: number, maxWidth: number): void {
  let value = text;
  while (value.length > 1 && doc.widthOfString(value, WHOLE_RUN) > maxWidth) {
    value = value.slice(0, -2) + '…';
  }
  let x = right;
  for (const run of runs(value)) {
    const text = shaped(run);
    x -= doc.widthOfString(text, WHOLE_RUN);
    doc.text(text, x, y, WHOLE_RUN);
  }
}

const cellText = (cell: ReportCell): string =>
  typeof cell === 'bigint' ? formatMoney(cell) : (cell ?? '');

export function writePdf(table: ReportTable): Promise<Buffer> {
  return writePdfs([table]);
}

/** Several tables in one file, each starting on its own page (e.g. one payslip per page). */
export function writePdfs(tables: ReportTable[]): Promise<Buffer> {
  if (tables.length === 0) {
    throw new Error('writePdfs needs at least one table');
  }
  const table = tables[0];
  const directory = fontDirectory();
  const landscape = table.columns.length > 6;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: MARGIN, bufferPages: true });
  doc.registerFont('body', path.join(directory, 'Vazirmatn-Regular.ttf'));
  doc.registerFont('bold', path.join(directory, 'Vazirmatn-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const usable = doc.page.width - 2 * MARGIN;
  const totalWeight = table.columns.reduce((total, column) => total + (column.width ?? 1), 0);
  const widths = table.columns.map((column) => (usable * (column.width ?? 1)) / totalWeight);
  const fontSize = table.columns.length > 8 ? 7 : table.columns.length > 5 ? 8 : 9;
  const bottom = doc.page.height - MARGIN - ROW_HEIGHT;
  const right = doc.page.width - MARGIN;
  let y = MARGIN;

  const header = (current: ReportTable): void => {
    doc.font('bold').fontSize(13);
    drawRtl(doc, current.title, right, y, usable);
    y += 22;
    doc.font('body').fontSize(9);
    drawRtl(doc, current.subtitle, right, y, usable);
    y += 20;
    doc.font('bold').fontSize(fontSize);
    drawRow(current.columns.map((column) => column.title));
    doc.moveTo(MARGIN, y - 3).lineTo(right, y - 3).lineWidth(0.8).stroke('#444444');
  };
  const drawRow = (cells: string[]): void => {
    let cellRight = right;
    cells.forEach((text, index) => {
      drawRtl(doc, text, cellRight - 3, y, widths[index] - 6);
      cellRight -= widths[index];
    });
    y += ROW_HEIGHT;
  };

  tables.forEach((current, index) => {
    if (index > 0) {
      doc.addPage();
      y = MARGIN;
    }
    header(current);
    for (const row of current.rows) {
      if (y > bottom) {
        doc.addPage();
        y = MARGIN;
        header(current);
      }
      doc.font(row.bold ? 'bold' : 'body').fontSize(fontSize);
      drawRow(row.cells.map(cellText));
    }
  });
  doc.end();
  return finished;
}
