import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { TaxComplianceController } from './controllers/tax-compliance.controller';
import { TaxInvoiceSignatureEntity } from './entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from './entities/tax-signing-key.entity';
import { TaxComplianceRepository } from './repositories/tax-compliance.repository';
import { TaxComplianceService } from './services/tax-compliance.service';

/**
 * ماژول تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها.
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق رمزنگاری (RSA/CSR/JWS)، هش و تولید TaxID ۲۲ رقمی.
 * - Repository: تنها لایه با دسترسی مستقیم به جداول مالیاتی.
 *
 * وابستگی یک‌طرفه به InvoicingModule برای بازیابی صورتحساب (بدون هیچ
 * import چرخه‌ای — Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TaxSigningKeyEntity, TaxInvoiceSignatureEntity]),
    InvoicingModule,
  ],
  controllers: [TaxComplianceController],
  providers: [TaxComplianceService, TaxComplianceRepository],
  exports: [TaxComplianceService],
})
export class TaxComplianceModule {}
