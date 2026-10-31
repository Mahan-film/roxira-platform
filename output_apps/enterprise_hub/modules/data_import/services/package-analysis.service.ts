import * as fsSync from 'fs';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { analysePackage } from '../analysis/package-analysis';
import { enrichTables } from '../analysis/enrich';
import { ParsedPackage } from '../parsers/package-source.types';
import { SqlDumpParseError } from '../parsers/sql-dump.parser';
import { SqliteParseError } from '../parsers/sqlite.parser';
import { ZipPackageError } from '../parsers/zip.parser';
import { readFormat, readFormatAs, readMultiFiles } from '../readers/format-registry';
import { buildTable, TableNotes } from '../readers/tabular';
import { packageOf } from '../readers/text-formats.reader';
import { MappingMemoryService } from './mapping-memory.service';
import { OcrResult, PackageOcrService } from './package-ocr.service';
import { EntityRegistryService } from '../registry/entity-registry.service';
import {
  PackageKind,
  PackageState,
  PackageStoreService,
  detectPackageKind,
} from './package-store.service';

/**
 * سرویس تحلیل بستهٔ دیتابیس: تجزیه (SQLite/SQL/ZIP) و اجرای تشخیص موجودیت،
 * روابط و بررسی‌های سلامت. نتیجه در وضعیت بسته روی دیسک موقت نوشته می‌شود.
 */
@Injectable()
export class PackageAnalysisService {
  private readonly logger = new Logger(PackageAnalysisService.name);

  constructor(
    private readonly store: PackageStoreService,
    private readonly registry: EntityRegistryService,
    @Optional() private readonly memory?: MappingMemoryService,
    @Optional() private readonly ocr?: PackageOcrService,
  ) {}

  /** تجزیهٔ بایت‌های بسته به جداول صفحه‌ای؛ قالب از روی «محتوا» تشخیص داده می‌شود. */
  async parsePackageBuffer(
    buffer: Buffer,
    fileName: string,
    kind?: PackageKind,
  ): Promise<ParsedPackage> {
    return kind && kind !== 'multi' && kind !== 'unknown'
      ? readFormatAs(kind, buffer, fileName)
      : readFormat(buffer, fileName);
  }

  /** باز کردن بستهٔ ذخیره‌شده (تک‌فایلی یا چندفایلی) به جداول صفحه‌ای. */
  async openPackage(state: PackageState): Promise<ParsedPackage> {
    if (state.ocr) {
      return this.ocrPackage(state.ocr);
    }
    if (state.kind === 'multi' && state.parts) {
      const parts = state.parts;
      return readMultiFiles(parts.length, (index) => {
        try {
          return { name: parts[index], buffer: fsSync.readFileSync(this.store.partFilePath(state.tenantId, state.packageId, index)) };
        } catch {
          return null;
        }
      });
    }
    const buffer = await this.store.readSource(state.tenantId, state.packageId);
    return this.parsePackageBuffer(buffer, state.fileName, state.kind);
  }

  /** A read-once OCR result as ordinary tables, so analysis, review and commit need no special path. */
  private ocrPackage(result: OcrResult): ParsedPackage {
    const notes = new TableNotes();
    const tables = result.tables.map((table, index) =>
      buildTable(`OCR ${index + 1}`, [table.headers, ...table.rows], notes),
    );
    return packageOf(result.source === 'image' ? 'image' : 'pdf', tables, notes, [
      `این داده با OCR از ${result.pages} تصویر خوانده شده و پیش از ثبت باید سند به سند بازبینی شود.`,
    ]);
  }

  /** The vision model is called here once; openPackage then reuses the stored tables. */
  private async runOcr(state: PackageState): Promise<void> {
    if (state.ocr || !this.ocr || state.kind === 'multi') {
      return;
    }
    const buffer = await this.store.readSource(state.tenantId, state.packageId);
    const pages = this.ocr.pagesOf(buffer, state.fileName);
    if (pages) {
      state.ocr = await this.ocr.read(pages);
    }
  }

  /** تحلیل کامل یک بسته و ثبت وضعیت «آماده» یا «ناموفق». */
  async analyze(tenantId: string, packageId: string): Promise<PackageState> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new BadRequestException('این بسته یافت نشد یا منقضی شده است.');
    }

    try {
      await this.runOcr(state);
      const parsed = await this.openPackage(state);
      try {
        const analysis = analysePackage(
          parsed.tables,
          this.registry.all(),
          parsed.relationships,
        );
        analysis.tables = await enrichTables(
          parsed.tables,
          analysis.tables,
          this.registry.all(),
          this.memory ? (signature) => this.memory!.recall(tenantId, signature) : undefined,
        );
        analysis.format = { id: parsed.formatId ?? state.kind, notes: parsed.notes ?? [], ocr: Boolean(state.ocr) };
        state.analysis = analysis;
        state.status = 'ready';
        state.error = undefined;
      } finally {
        parsed.close();
      }
    } catch (error) {
      state.status = 'failed';
      state.error = this.persianError(error);
      this.logger.warn(
        `[PACKAGE-IMPORT] تحلیل بسته ${packageId} ناموفق بود: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.store.writeState(state);
    return state;
  }

  /** تبدیل هر خطای تجزیه به پیام فارسی قابل نمایش. */
  private persianError(error: unknown): string {
    if (
      error instanceof SqliteParseError ||
      error instanceof SqlDumpParseError ||
      error instanceof ZipPackageError
    ) {
      return error.message;
    }
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      return typeof response === 'string' ? response : error.message;
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'تحلیل بسته ناموفق بود.';
  }
}
