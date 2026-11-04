import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { CaptureDocumentEntity } from '../invoice_capture/entities/capture.entities';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { MOADIAN_QUEUE } from './constants/moadian.constants';
import { MoadianController } from './controllers/moadian.controller';
import { DoctorWithholdingController } from './controllers/doctor-withholding.controller';
import { DoctorWithholdingService } from './services/doctor-withholding.service';
import { RentalTaxController } from './controllers/rental-tax.controller';
import { RentalTaxService } from './services/rental-tax.service';
import { BusinessTaxController } from './controllers/business-tax.controller';
import { BusinessTaxService } from './services/business-tax.service';
import { CorporateTaxController } from './controllers/corporate-tax.controller';
import { StatutoryParameterEntity } from '../hr/statutory/statutory-parameter.entity';
import { StatutoryRepository } from '../hr/statutory/statutory.repository';
import { CorporateTaxService } from './services/corporate-tax.service';
import { LedgerExportController } from './controllers/ledger-export.controller';
import { SeasonalReportController } from './controllers/seasonal-report.controller';
import { TaxComplianceController } from './controllers/tax-compliance.controller';
import { MoadianCredentialEntity } from './entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from './entities/moadian-submission.entity';
import { TaxInvoiceSignatureEntity } from './entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from './entities/tax-signing-key.entity';
import { MoadianProcessor } from './processors/moadian.processor';
import { TenantScope } from '../access/services/tenant-scope';
import { LedgerExportRepository } from './reports/ledger-export.repository';
import { LedgerExportService } from './reports/ledger-export.service';
import { SeasonalReportRepository } from './reports/seasonal-report.repository';
import { SeasonalReportService } from './reports/seasonal-report.service';
import { VatReturnRepository } from './reports/vat-return.repository';
import { VatReturnService } from './reports/vat-return.service';
import { MoadianRepository } from './repositories/moadian.repository';
import { TaxComplianceRepository } from './repositories/tax-compliance.repository';
import { MoadianApiClient } from './services/moadian-api.client';
import { MoadianService } from './services/moadian.service';
import { TaxComplianceService } from './services/tax-compliance.service';

/**
 * ماژول تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها.
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق رمزنگاری (RSA/CSR/JWS)، هش و تولید TaxID ۲۲ رقمی.
 * - Repository: تنها لایه با دسترسی مستقیم به جداول مالیاتی.
 * - Moadian*: اتصال زنده به سامانه مودیان پشت پرچم MOADIAN_ENABLED (صف BullMQ `moadian`).
 *
 * وابستگی یک‌طرفه به InvoicingModule برای بازیابی صورتحساب (بدون هیچ
 * import چرخه‌ای — Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaxSigningKeyEntity,
      TaxInvoiceSignatureEntity,
      MoadianCredentialEntity,
      MoadianSubmissionEntity,
      InvoiceEntity,
      CaptureDocumentEntity,
      StatutoryParameterEntity,
    ]),
    InvoicingModule,
    BullModule.registerQueue({ name: MOADIAN_QUEUE }),
  ],
  controllers: [TaxComplianceController, MoadianController, SeasonalReportController, LedgerExportController, CorporateTaxController, BusinessTaxController, RentalTaxController, DoctorWithholdingController],
  providers: [
    TaxComplianceService,
    TaxComplianceRepository,
    MoadianService,
    MoadianRepository,
    MoadianApiClient,
    MoadianProcessor,
    SeasonalReportService,
    CorporateTaxService,
    BusinessTaxService,
    RentalTaxService,
    DoctorWithholdingService,
    StatutoryRepository,
    LedgerExportRepository,
    LedgerExportService,
    VatReturnRepository,
    VatReturnService,
    TenantScope,
    SeasonalReportRepository,
  ],
  exports: [TaxComplianceService, VatReturnService],
})
export class TaxComplianceModule {}
