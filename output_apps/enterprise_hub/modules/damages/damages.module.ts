import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DamagesController } from './controllers/damages.controller';
import { DAMAGES_QUEUE_NAME } from './constants/damages.constants';
import { DamageCalculationEntity } from './entities/damage-calculation.entity';
import { DamagesQueueProcessor } from './processors/damages-queue.processor';
import { DamagesRepository } from './repositories/damages.repository';
import { DamagesService } from './services/damages.service';

/**
 * ماژول خسارت تاخیر تادیه (Delay Damages / خسارت تاخیر تادیه).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار محاسبات حقوقی/مالی.
 * - Repository: تنها لایه با دسترسی مستقیم به پایگاه‌داده.
 * - Processor: پردازش ناهمزمان دسته‌ای از طریق Redis/BullMQ.
 *
 * بدون هیچ import چرخه‌ای (Circular Dependency) با سایر ماژول‌ها.
 *
 * وابستگی‌های لازم (package.json):
 *   @nestjs/common, @nestjs/core, @nestjs/typeorm, @nestjs/swagger,
 *   @nestjs/bullmq, bullmq, typeorm, class-validator, class-transformer
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DamageCalculationEntity]),
    BullModule.registerQueue({ name: DAMAGES_QUEUE_NAME }),
  ],
  controllers: [DamagesController],
  providers: [DamagesService, DamagesRepository, DamagesQueueProcessor],
  exports: [DamagesService],
})
export class DamagesModule {}
