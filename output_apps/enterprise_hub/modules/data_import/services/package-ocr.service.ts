import { Injectable } from '@nestjs/common';
import { extractPdfJpegs } from '../parsers/pdf-images';
import { imageMimeType, sniffFileKind } from '../parsers/file-kind';
import { ParsedTable, parsePdf, ScannedPdfError } from '../parsers/pdf.parser';
import { MAX_VISION_PAGES } from '../constants/data-import.constants';
import { ReaderError } from '../readers/reader.types';
import { OpenRouterVisionService, VisionImage } from './openrouter-vision.service';

/** Upper bound on pages sent to the model for one upload (one call per MAX_VISION_PAGES pages). */
export const MAX_OCR_PAGES = 30;

export interface OcrResult {
  source: 'image' | 'scanned-pdf';
  pages: number;
  tables: ParsedTable[];
}

/**
 * OCR for one uploaded image or scanned PDF, through the `vision` role of config/models.yaml.
 * A picture cannot be masked, so it reaches the model as it is (`data_collection: deny`); everything
 * read from it counts as a proposal: PackageImportService refuses to commit it without a review.
 */
@Injectable()
export class PackageOcrService {
  constructor(private readonly vision: OpenRouterVisionService) {}

  /** The pages of a file that needs OCR; null for anything with readable data. */
  pagesOf(buffer: Buffer, fileName: string): { source: OcrResult['source']; images: VisionImage[] } | null {
    const kind = sniffFileKind(buffer, fileName);
    if (kind === 'image') {
      const mimeType = imageMimeType(buffer);
      if (!mimeType) {
        throw new ReaderError('فرمت تصویر پشتیبانی نمی‌شود؛ فقط JPG، PNG یا WEBP مجاز است.');
      }
      return { source: 'image', images: [{ mimeType, base64: buffer.toString('base64') }] };
    }
    if (kind !== 'pdf') {
      return null;
    }
    try {
      parsePdf(buffer);
      return null;
    } catch (error) {
      if (!(error instanceof ScannedPdfError)) {
        return null; // the PDF reader reports this one
      }
    }
    const jpegs = extractPdfJpegs(buffer, MAX_OCR_PAGES + 1);
    if (jpegs.length === 0) {
      throw new ReaderError('تصویر صفحه‌های این PDF در قالب قابل‌خواندن نیست؛ از صفحه‌ها عکس JPG یا PNG بگیرید و بفرستید.');
    }
    if (jpegs.length > MAX_OCR_PAGES) {
      throw new ReaderError(`این PDF بیش از ${MAX_OCR_PAGES} صفحه دارد؛ آن را به چند فایل تقسیم کنید.`);
    }
    return {
      source: 'scanned-pdf',
      images: jpegs.map((jpeg) => ({ mimeType: 'image/jpeg', base64: jpeg.toString('base64') })),
    };
  }

  async read(pages: { source: OcrResult['source']; images: VisionImage[] }): Promise<OcrResult> {
    const tables: ParsedTable[] = [];
    for (let i = 0; i < pages.images.length; i += MAX_VISION_PAGES) {
      let table: ParsedTable;
      try {
        table = await this.vision.extractTable(pages.images.slice(i, i + MAX_VISION_PAGES));
      } catch (error) {
        throw new ReaderError(`خواندن تصویر با OCR ناموفق بود: ${error instanceof Error ? error.message : 'خطای ناشناخته'}`);
      }
      const same = tables.find((t) => t.headers.join('|') === table.headers.join('|'));
      if (same) {
        same.rows.push(...table.rows);
      } else {
        tables.push(table);
      }
    }
    return { source: pages.source, pages: pages.images.length, tables };
  }
}
