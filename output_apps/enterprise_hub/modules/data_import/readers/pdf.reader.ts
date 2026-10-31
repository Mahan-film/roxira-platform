/**
 * PDF متنی در ورود بسته: لایهٔ متن به جدول تبدیل می‌شود و هیچ مدلی صدا زده نمی‌شود.
 * PDF اسکن‌شده اینجا رد می‌شود و برای بارگذاری تکی به PackageOcrService می‌رود.
 */

import { sniffFileKind } from '../parsers/file-kind';
import { parsePdf, PdfParseError, ScannedPdfError } from '../parsers/pdf.parser';
import { PDF_IMAGE_MESSAGE } from './guide-only.readers';
import { FormatReader, ReaderError, UnsupportedFormatError } from './reader.types';
import { buildTable, TableNotes } from './tabular';
import { packageOf } from './text-formats.reader';

export const pdfReader: FormatReader = {
  id: 'pdf',
  labelFa: 'PDF',
  extensions: ['.pdf'],
  detect: (buffer, fileName) => (sniffFileKind(buffer, fileName) === 'pdf' ? 0.99 : 0),
  read(buffer) {
    try {
      const parsed = parsePdf(buffer);
      const notes = new TableNotes();
      const table = buildTable('PDF', [parsed.headers, ...parsed.rows], notes);
      return packageOf('pdf', [table], notes, ['جدول از لایهٔ متن PDF خوانده شد؛ ستون‌بندی را در بازبینی بررسی کنید.']);
    } catch (error) {
      if (error instanceof ScannedPdfError) {
        throw new UnsupportedFormatError('pdf', PDF_IMAGE_MESSAGE);
      }
      if (error instanceof PdfParseError) {
        throw new ReaderError(error.message);
      }
      throw error;
    }
  },
};
