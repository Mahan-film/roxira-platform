import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingModule } from '../accounting/accounting.module';
import { CaptureController } from './controllers/capture.controller';
import {
  CaptureAuditEntity,
  CaptureDocumentEntity,
  CaptureFileEntity,
  CaptureSettingsEntity,
  CaptureVendorEntity,
  CaptureVendorRuleEntity,
} from './entities/capture.entities';
import { CaptureRepository } from './repositories/capture.repository';
import { CaptureLlmService } from './services/capture-llm.service';
import { CaptureService } from './services/capture.service';

/**
 * Invoice capture for the assistant chat. Depends only on AccountingModule (posting and period
 * locks); nothing depends on this module (no cycles, AGENTS.md Rule #1).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CaptureDocumentEntity,
      CaptureFileEntity,
      CaptureVendorEntity,
      CaptureVendorRuleEntity,
      CaptureSettingsEntity,
      CaptureAuditEntity,
    ]),
    AccountingModule,
  ],
  controllers: [CaptureController],
  providers: [CaptureService, CaptureLlmService, CaptureRepository, TenantScope],
  exports: [CaptureService],
})
export class InvoiceCaptureModule {}
