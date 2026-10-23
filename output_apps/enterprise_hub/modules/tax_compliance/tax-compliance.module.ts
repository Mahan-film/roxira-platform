import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { MOADIAN_QUEUE } from './constants/moadian.constants';
import { MoadianController } from './controllers/moadian.controller';
import { TaxComplianceController } from './controllers/tax-compliance.controller';
import { MoadianCredentialEntity } from './entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from './entities/moadian-submission.entity';
import { TaxInvoiceSignatureEntity } from './entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from './entities/tax-signing-key.entity';
import { MoadianProcessor } from './processors/moadian.processor';
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
    ]),
    InvoicingModule,
    BullModule.registerQueue({ name: MOADIAN_QUEUE }),
  ],
  controllers: [TaxComplianceController, MoadianController],
  providers: [
    TaxComplianceService,
    TaxComplianceRepository,
    MoadianService,
    MoadianRepository,
    MoadianApiClient,
    MoadianProcessor,
  ],
  exports: [TaxComplianceService],
})
export class TaxComplianceModule {}
