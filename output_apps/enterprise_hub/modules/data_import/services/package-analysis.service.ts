import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { analysePackage } from '../analysis/package-analysis';
import { ParsedPackage } from '../parsers/package-source.types';
import { openSqlDump, SqlDumpParseError } from '../parsers/sql-dump.parser';
import { openSqlite, SqliteParseError } from '../parsers/sqlite.parser';
import { parseZipPackage, ZipPackageError } from '../parsers/zip.parser';
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
  ) {}

  /** تجزیهٔ بایت‌های بسته به جداول صفحه‌ای بر پایهٔ نوع آن. */
  async parsePackageBuffer(
    buffer: Buffer,
    fileName: string,
    kind?: PackageKind,
  ): Promise<ParsedPackage> {
    const resolved = kind ?? detectPackageKind(fileName, buffer);
    if (resolved === 'sqlite') {
      return openSqlite(buffer);
    }
    if (resolved === 'sql') {
      return openSqlDump(buffer.toString('utf8'));
    }
    return parseZipPackage(buffer);
  }

  /** تحلیل کامل یک بسته و ثبت وضعیت «آماده» یا «ناموفق». */
  async analyze(tenantId: string, packageId: string): Promise<PackageState> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new BadRequestException('این بسته یافت نشد یا منقضی شده است.');
    }
    const buffer = await this.store.readSource(tenantId, packageId);

    try {
      const parsed = await this.parsePackageBuffer(
        buffer,
        state.fileName,
        state.kind,
      );
      try {
        state.analysis = analysePackage(
          parsed.tables,
          this.registry.all(),
          parsed.relationships,
        );
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
