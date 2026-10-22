import { deflateSync } from 'zlib';
import {
  isPdf,
  parsePdf,
  PdfParseError,
  ScannedPdfError,
} from './pdf.parser';

/** ساخت یک PDF متنی کمینه (بدون xref؛ پارسر اشیا را مستقیم می‌خواند). */
function makeTextPdf(content: string, { compress = false } = {}): Buffer {
  let data = Buffer.from(content, 'latin1');
  let filter = '';
  if (compress) {
    data = deflateSync(data);
    filter = ' /Filter /FlateDecode';
  }
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${data.length}${filter} >>\n` +
      `stream\n${data.toString('latin1')}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  return Buffer.from(
    `%PDF-1.4\n${objects.join('')}trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`,
    'latin1',
  );
}

/** یک صفحه با چهار سلول در دو ستون و دو ردیف. */
const TWO_COLUMN_CONTENT = [
  'BT /F1 12 Tf',
  '1 0 0 1 72 720 Tm (full name) Tj',
  '1 0 0 1 260 720 Tm (email) Tj',
  '1 0 0 1 72 700 Tm (Sara Ahmadi) Tj',
  '1 0 0 1 260 700 Tm (sara@x.com) Tj',
  'ET',
].join('\n');

describe('isPdf', () => {
  it('detects the %PDF- signature', () => {
    expect(isPdf(makeTextPdf('BT ET'))).toBe(true);
    expect(isPdf(Buffer.from('not a pdf'))).toBe(false);
  });
});

describe('parsePdf', () => {
  it('extracts headers and rows from a plain text PDF', () => {
    const parsed = parsePdf(makeTextPdf(TWO_COLUMN_CONTENT));

    expect(parsed.headers).toEqual(['full name', 'email']);
    expect(parsed.rows).toEqual([['Sara Ahmadi', 'sara@x.com']]);
  });

  it('extracts text from a FlateDecode-compressed content stream', () => {
    const parsed = parsePdf(makeTextPdf(TWO_COLUMN_CONTENT, { compress: true }));

    expect(parsed.headers).toEqual(['full name', 'email']);
    expect(parsed.rows).toEqual([['Sara Ahmadi', 'sara@x.com']]);
  });

  it('rejects a non-PDF buffer with a Persian error', () => {
    expect(() => parsePdf(Buffer.from('plain text', 'utf8'))).toThrow(
      PdfParseError,
    );
  });

  it('rejects a scanned PDF (no extractable text) with ScannedPdfError', () => {
    const noText = 'BT /F1 12 Tf 1 0 0 1 72 720 Tm ET';
    expect(() => parsePdf(makeTextPdf(noText))).toThrow(ScannedPdfError);
  });
});
