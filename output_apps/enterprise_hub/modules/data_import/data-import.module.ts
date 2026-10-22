import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JWT_DEFAULT_EXPIRES_IN } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CrmModule } from '../crm/crm.module';
import { DataImportController } from './controllers/data-import.controller';
import { DataImportRepository } from './repositories/data-import.repository';
import { DataImportService } from './services/data-import.service';
import { OpenRouterMappingService } from './services/openrouter-mapping.service';
import { OpenRouterVisionService } from './services/openrouter-vision.service';
import { UploadStoreService } from './services/upload-store.service';

/**
 * ماژول ورود داده با کمک هوش مصنوعی (AI-assisted data import).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: مسیریابی HTTP + بارگذاری فایل + کنترل دسترسی.
 * - Service: تجزیه CSV/XLSX/PDF متنی و استخراج جدول از تصویر (مدل بینایی)،
 *   نگاشت ستون‌ها، اعتبارسنجی و ورود گروهی.
 * - Repository: تنها لایه نوشتن، از طریق `CrmRepository` موجود.
 *
 * `CrmModule` فقط برای دسترسی به `CrmRepository` import می‌شود تا ردیف‌ها با
 * مستأجر فراخوان درج شوند و هیچ وابستگی چرخه‌ای ایجاد نشود (Rule #1).
 */
@Module({
  imports: [
    ConfigModule,
    CrmModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', ''),
        signOptions: {
          expiresIn: config.get<string>(
            'JWT_EXPIRES_IN',
            JWT_DEFAULT_EXPIRES_IN,
          ),
        },
      }),
    }),
  ],
  controllers: [DataImportController],
  providers: [
    DataImportService,
    DataImportRepository,
    OpenRouterMappingService,
    OpenRouterVisionService,
    UploadStoreService,
    JwtAuthGuard,
  ],
  exports: [DataImportService],
})
export class DataImportModule {}
